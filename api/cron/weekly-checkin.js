const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ message: 'No active clients', sent: 0 });
  }

  let sent = 0;
  const now = new Date();

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .single();

    if (existingCheckin) continue;

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

    await sendTemplate(client.phone, 'weekly_checkin', [
      client.name || 'there',
      `Week ${currentWeek}`,
      checkinUrl
    ]);
    await logMessage(client.phone, 'out', `[Check-in form: Week ${currentWeek}]`, 'weekly_checkin');
    sent++;
  }

  return res.status(200).json({ message: `Check-in reminders sent`, sent });
};
