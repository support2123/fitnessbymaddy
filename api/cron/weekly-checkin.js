const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sb = getSupabase();

    const { data: clients } = await sb
      .from('clients')
      .select('id, phone, name, program, program_started_at, lead_id')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    const results = [];

    for (const client of clients) {
      const weeksElapsed = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksElapsed < 1) continue;

      const { data: existingCheckin } = await sb
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weeksElapsed)
        .maybeSingle();

      if (existingCheckin) continue;

      const { data: lead } = await sb
        .from('leads')
        .select('market')
        .eq('id', client.lead_id)
        .maybeSingle();

      const market = lead?.market || 'GLOBAL';
      const hinglish = isHinglish(market);
      const formUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weeksElapsed}`;

      await sendTemplate(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: hinglish
          ? [
              client.name || 'there',
              `Week ${weeksElapsed} ka check-in time! Form fill karo:`,
              formUrl,
            ]
          : [
              client.name || 'there',
              `Time for your Week ${weeksElapsed} check-in!`,
              formUrl,
            ],
      });

      await checkMissedCheckins(client.id);

      results.push({ client_id: client.id, week: weeksElapsed });
    }

    return res.status(200).json({ success: true, sent: results.length, details: results });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
