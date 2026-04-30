const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (error) throw error;
    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let nudged = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weeksElapsed = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) /
        (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksElapsed < 1) continue;

      const weekNo = weeksElapsed;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.leads?.market || 'GLOBAL';
      const templateName = isHinglish(market) ? 'weekly_checkin' : 'weekly_checkin_en';

      await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);
      sent++;

      const wasEscalated = await checkMissedCheckins(client.id, supabase);
      if (wasEscalated) escalated++;

      const prevWeek = weekNo - 1;
      if (prevWeek > 0) {
        const { data: prevCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', prevWeek)
          .limit(1);

        if (!prevCheckin || prevCheckin.length === 0) {
          nudged++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      processed: activeClients.length,
      sent,
      nudged,
      escalated,
    });
  } catch (err) {
    console.error('[cron/weekly-checkin]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
