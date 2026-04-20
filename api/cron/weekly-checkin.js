const { supabase } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: activeClients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ status: 'no_active_clients' });
  }

  let sent = 0;
  let skipped = 0;

  for (const client of activeClients) {
    const weekNo = calculateWeekNo(client.program_started_at);
    if (weekNo < 1) { skipped++; continue; }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existing) { skipped++; continue; }

    const missedCount = await countMissedCheckins(client.id, weekNo);
    if (missedCount >= 2) {
      await notifyMaddy(
        '2 consecutive missed check-ins',
        `Client: ${client.name || client.phone}\nProgram: ${client.program}\nWeek: ${weekNo}`
      );
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
    const market = detectMarketFromPhone(client.phone);

    const msg = market === 'IN'
      ? `Hey ${client.name || 'there'}! 🏋️ Week ${weekNo} check-in time!\n\nApna progress update karo — sirf 2 min lagenge:\n${checkinUrl}\n\nPhotos + weight + waist zaroor daalna 📸`
      : `Hey ${client.name || 'there'}! 🏋️ Time for your Week ${weekNo} check-in!\n\nUpdate your progress — takes just 2 mins:\n${checkinUrl}\n\nDon't forget photos + weight + waist 📸`;

    await sendText(client.phone, msg);
    sent++;
  }

  return res.status(200).json({ status: 'done', sent, skipped });
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.floor(diffMs / (7 * 86400000)) + 1;
}

async function countMissedCheckins(clientId, currentWeek) {
  let missed = 0;
  for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - 2); w--) {
    const { data } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', clientId)
      .eq('week_no', w)
      .single();
    if (!data) missed++;
  }
  return missed;
}

function detectMarketFromPhone(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  return 'GLOBAL';
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
