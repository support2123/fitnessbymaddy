const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { needsEscalation, createEscalation } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients, error } = await db
    .from('clients')
    .select('id, phone, name, program, program_started_at, market:leads(market)')
    .eq('status', 'active');

  if (error || !activeClients) {
    console.error('weekly-checkin: failed to fetch clients', error?.message);
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  let sent = 0;
  let skipped = 0;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / 86400000);
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) {
      skipped++;
      continue;
    }

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .maybeSingle();

    if (existingCheckin) {
      skipped++;
      continue;
    }

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    const lastTwoWeeks = [weekNo - 1, weekNo - 2];
    const missedWeeks = missedCheckins
      ? lastTwoWeeks.filter((w) => w > 0 && !missedCheckins.some((c) => c.week_no === w))
      : [];

    if (missedWeeks.length >= 2) {
      await createEscalation(
        client.phone,
        '2 consecutive missed check-ins',
        `Client ${client.name || client.id} missed weeks ${missedWeeks.join(', ')}`,
        client.id
      );
    }

    const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
    await sendTemplate(client.phone, 'weekly_checkin', [
      client.name || 'there',
      String(weekNo),
      checkinUrl,
    ]);
    sent++;
  }

  return res.status(200).json({ ok: true, sent, skipped, total: activeClients.length });
};
