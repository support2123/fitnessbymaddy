const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { checkMissedCheckins } = require('../lib/escalation');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!clients || clients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin && existingCheckin.form_submitted_at) continue;

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarketFromPhone(client.phone);
      const templateName = isHinglish(market) ? 'weekly_checkin' : 'weekly_checkin_en';

      await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        String(weekNo),
        checkinUrl
      ]);
      sent++;

      const prevWeek = weekNo - 1;
      if (prevWeek > 0) {
        const { data: prevCheckin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', prevWeek)
          .single();

        if (!prevCheckin || !prevCheckin.form_submitted_at) {
          const prevUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${prevWeek}`;
          await sendTemplate(client.phone, 'checkin_nudge', [
            client.name || 'there',
            String(prevWeek),
            prevUrl
          ]);
          nudged++;

          await checkMissedCheckins(client.id);
        }
      }
    }

    return res.status(200).json({
      action: 'weekly_checkin_sent',
      clients_total: clients.length,
      sent,
      nudged
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function detectMarketFromPhone(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}
