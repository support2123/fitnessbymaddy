const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !isAuthed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: lastCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const lastWeekSubmitted = lastCheckin?.week_no || 0;

      if (lastWeekSubmitted >= currentWeek) continue;

      const missedWeeks = currentWeek - lastWeekSubmitted - 1;
      if (missedWeeks >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          name: client.name,
          message: `${client.name} has missed ${missedWeeks} consecutive check-ins (last submitted: week ${lastWeekSubmitted}, current: week ${currentWeek}).`
        });
        escalated++;
      }

      const market = detectMarket(client.phone);
      const template = isHinglish(market) ? 'checkin_reminder_hi' : 'checkin_reminder_en';
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

      await sendWhatsApp(client.phone, template, {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          String(currentWeek),
          checkinUrl
        ]
      });

      sent++;
    }

    return res.json({ message: 'Weekly check-in reminders sent', sent, escalated });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
