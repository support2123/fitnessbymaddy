const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, skipped: 0, escalated: 0 };

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .not('program', 'eq', 'zoom_trial');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) {
        results.skipped++;
        continue;
      }

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1)
        .single();

      if (existingCheckin) {
        results.skipped++;
        continue;
      }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastSubmitted = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = weekNo - lastSubmitted - 1;

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name || client.phone}, missed weeks ${lastSubmitted + 1}-${weekNo - 1}`
        );
        results.escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = client.phone.startsWith('+91') ? 'IN' : 'GLOBAL';

      const msgBody = market === 'IN'
        ? [`Hey ${client.name || 'there'}! Week ${weekNo} check-in time. Form fill karo: ${checkinUrl}`]
        : [`Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in: ${checkinUrl}`];

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        bodyValues: msgBody,
      });

      results.sent++;
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
