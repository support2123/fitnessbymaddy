const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { checkMissedCheckins } = require('../../lib/escalation');
const { weeksBetween } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients, error } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (error || !activeClients) {
    console.error('Failed to fetch active clients:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  let sent = 0;
  let skipped = 0;

  for (const client of activeClients) {
    const currentWeek =
      weeksBetween(client.program_started_at, new Date().toISOString()) + 1;

    if (currentWeek < 1) {
      skipped++;
      continue;
    }

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .maybeSingle();

    if (existingCheckin) {
      skipped++;
      continue;
    }

    await checkMissedCheckins(client.id, client.phone);

    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

    await sendWhatsApp(client.phone, 'weekly_checkin', [
      client.name || 'there',
      `${currentWeek}`,
      checkinUrl,
    ]);

    sent++;
  }

  return res.status(200).json({
    action: 'weekly_checkin_sent',
    sent,
    skipped,
    total: activeClients.length,
  });
};
