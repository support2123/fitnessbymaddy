const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/escalation');
const { json } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && req.headers['x-internal-key'] !== process.env.SUPABASE_SERVICE_KEY) {
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    if (!isVercelCron) {
      return json(res, 401, { error: 'Unauthorized' });
    }
  }

  const db = getSupabase();

  const { data: activeClients, error } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', new Date().toISOString());

  if (error || !activeClients) {
    return json(res, 500, { error: 'Failed to fetch clients' });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (24 * 60 * 60 * 1000));
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) continue;

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existing) continue;

    const { data: missedWeeks } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const lastSubmittedWeek = missedWeeks && missedWeeks.length > 0
      ? missedWeeks[0].week_no
      : 0;
    const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

    if (consecutiveMissed >= 2) {
      await notifyMaddy(
        '2 consecutive missed check-ins',
        `Client: ${client.name || client.id}\nPhone: ${(client.phone || '').substring(0, 4)}XXX\nProgram: ${client.program}\nMissed weeks: ${consecutiveMissed}`
      );
      escalated++;
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

    await sendWhatsApp(client.phone, 'weekly_checkin', [
      client.name || 'there',
      String(weekNo),
      checkinUrl,
    ]);

    sent++;
  }

  return json(res, 200, { success: true, sent, escalated, total: activeClients.length });
};
