const { getSupabase } = require('../lib/supabase');
const { sendMessage } = require('../lib/whatsapp');
const { logMessage } = require('../lib/ratelimit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ message: 'No active clients' });
  }

  const results = [];
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://fitnessbymaddy.com';

  for (const client of activeClients) {
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

    const checkinUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;
    const market = client.market || detectMarketFromPhone(client.phone);

    const message = market === 'IN'
      ? `Hey ${client.name || 'champion'}! 📋 Week ${weekNo} check-in time. Form fill karo: ${checkinUrl}`
      : `Hey ${client.name || 'champion'}! 📋 Time for your Week ${weekNo} check-in: ${checkinUrl}`;

    await sendMessage(client.phone, message);
    await logMessage(client.phone, 'out', message, 'weekly_checkin');
    results.push({ client_id: client.id, week_no: weekNo });
  }

  return res.status(200).json({ sent: results.length, results });
};

function detectMarketFromPhone(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}
