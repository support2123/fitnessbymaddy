const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { checkMissedCheckins } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = req.headers['x-vercel-cron'];
  if (!cronSecret && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ ok: true, message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of clients) {
      const weeksElapsed = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksElapsed < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weeksElapsed)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weeksElapsed}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        params: [
          client.name || 'there',
          `${weeksElapsed}`,
          checkinUrl
        ]
      });
      sent++;

      await checkMissedCheckins(client.id, client.phone);
    }

    await scheduleNudges(clients);

    return res.json({ ok: true, sent, total_clients: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

async function scheduleNudges(clients) {
  // Nudge logic is handled by nudge-dropped cron
  // This function is a placeholder for future 24hr/48hr nudge scheduling
}
