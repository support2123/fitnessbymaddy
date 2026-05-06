const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', new Date().toISOString());

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ message: 'No active clients' });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .limit(1);

    if (existingCheckin && existingCheckin.length > 0) continue;

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const lastSubmittedWeek = missedCheckins && missedCheckins.length > 0
      ? missedCheckins[0].week_no : 0;
    const consecutiveMissed = currentWeek - lastSubmittedWeek - 1;

    if (consecutiveMissed >= 2) {
      await notifyMaddy(`2 missed check-ins: ${client.name} (${client.phone.slice(-4)}), week ${currentWeek}`);
      escalated++;
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
    await sendWhatsApp(client.phone, 'weekly_checkin', {
      name: client.name,
      templateParams: [client.name, currentWeek.toString(), checkinUrl]
    });
    sent++;
  }

  return res.status(200).json({ sent, escalated, total: activeClients.length });
};
