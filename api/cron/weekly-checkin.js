const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lt('program_ends_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ message: 'No active clients due for check-in' });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const weeksSinceStart = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weeksSinceStart)
      .single();

    if (existingCheckin) continue;

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const lastCheckedWeek = missedCheckins?.[0]?.week_no || 0;
    const consecutiveMissed = weeksSinceStart - lastCheckedWeek - 1;

    if (consecutiveMissed >= 2) {
      await notifyMaddy(
        '2 MISSED CHECK-INS',
        `${client.name || 'Client'} (${client.program}) missed ${consecutiveMissed} consecutive weeks`
      );
      escalated++;
    }

    const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksSinceStart}`;

    await sendWhatsApp(client.phone, 'weekly_checkin', {
      name: client.name || 'Champion',
      templateParams: [String(weeksSinceStart), checkinUrl]
    });

    sent++;
  }

  return res.status(200).json({ sent, escalated, total: activeClients.length });
};
