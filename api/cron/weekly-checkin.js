const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { json } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const db = getSupabase();

  const { data: clients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return json(res, 200, { action: 'no-active-clients' });
  }

  const results = [];

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .limit(1);

    if (existingCheckin && existingCheckin.length > 0) continue;

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

    await sendWhatsApp(client.phone, 'weekly_checkin', [
      client.name || 'there',
      `${currentWeek}`,
      checkinUrl,
    ]);

    results.push({ client_id: client.id, week: currentWeek });
  }

  return json(res, 200, { sent: results.length, details: results });
};
