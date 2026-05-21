const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    const results = [];

    for (const client of clients) {
      const weeksElapsed = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksElapsed < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weeksElapsed)
        .single();

      if (existingCheckin) continue;

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weeksElapsed}`;
      const market = client.leads?.market || 'IN';
      const template = isHinglish(market) ? 'checkin_reminder_hi' : 'checkin_reminder_en';

      const result = await sendTemplate(client.phone, template, [
        client.name || 'there',
        weeksElapsed.toString(),
        checkinUrl,
      ]);

      if (result.ok) sent++;
      results.push({ client_id: client.id, week: weeksElapsed, sent: result.ok });

      await checkMissedCheckins(client.id, client.phone);
    }

    return res.json({ message: `Check-in reminders sent`, sent, total: clients.length, results });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
