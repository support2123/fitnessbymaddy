const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: clients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return res.status(200).json({ message: 'No active clients' });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) continue;

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existingCheckin) continue;

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const lastSubmitted = missedCheckins?.[0]?.week_no || 0;
    const consecutiveMissed = weekNo - lastSubmitted - 1;

    if (consecutiveMissed >= 2) {
      await escalateToMaddy('2 consecutive missed check-ins', {
        phone: client.phone,
        message: `Client ${client.name} missed ${consecutiveMissed} consecutive check-ins`
      });
      escalated++;
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

    await sendWhatsApp(client.phone, 'weekly_checkin', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(weekNo), checkinUrl]
    });

    sent++;
  }

  return res.status(200).json({ sent, escalated, total_clients: clients.length });
};
