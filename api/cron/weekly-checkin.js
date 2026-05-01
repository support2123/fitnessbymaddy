const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../../lib/whatsapp');
const { jsonResponse } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(res, { error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return jsonResponse(res, { error: 'Unauthorized' }, 401);
  }

  const db = getSupabase();

  const { data: activeClients, error } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', new Date().toISOString());

  if (error) {
    console.error('Fetch clients error:', error.message);
    return jsonResponse(res, { error: 'Failed to fetch clients' }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let escalated = 0;

  for (const client of activeClients || []) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) {
      skipped++;
      continue;
    }

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .single();

    if (existingCheckin) {
      skipped++;
      continue;
    }

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
    const consecutiveMissed = currentWeek - lastSubmittedWeek - 1;

    if (consecutiveMissed >= 2) {
      await notifyMaddy(
        '2 consecutive missed check-ins',
        `Client: ${client.name} (${client.phone})\nProgram: ${client.program}\nLast check-in: Week ${lastSubmittedWeek}`
      );
      escalated++;
    }

    const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

    await sendTemplate(client.phone, 'weekly_checkin', [
      client.name || 'there',
      String(currentWeek),
      checkinUrl,
    ]);

    sent++;
  }

  return jsonResponse(res, {
    ok: true,
    sent,
    skipped,
    escalated,
    total: activeClients?.length || 0,
  });
};
