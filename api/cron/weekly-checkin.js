const { supabase } = require('../../lib/supabase');
const { sendTemplate, notifyMaddy, isRateLimitedForLead } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ action: 'no_active_clients' });
    }

    const results = [];

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        results.push({ client_id: client.id, action: 'already_submitted' });
        continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      const { data: lead } = client.lead_id
        ? await supabase.from('leads').select('market').eq('id', client.lead_id).single()
        : { data: null };

      const market = lead?.market || 'GLOBAL';
      const templateName = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin';

      await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        String(weekNo),
        checkinUrl
      ]);

      results.push({ client_id: client.id, week_no: weekNo, action: 'sent' });

      const { data: prevCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (prevCheckins && prevCheckins.length >= 1) {
        const lastWeek = prevCheckins[0].week_no;
        if (weekNo - lastWeek >= 3) {
          await notifyMaddy(
            '2+ consecutive missed check-ins',
            `Client: ${client.name}\nPhone: ${client.phone}\nLast check-in: Week ${lastWeek}\nCurrent: Week ${weekNo}`
          );
        }
      }
    }

    return res.json({ action: 'completed', count: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startedAt) {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}
