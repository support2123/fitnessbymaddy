const crypto = require('crypto');
const supabase = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglishMarket } = require('../_lib/market');
const { checkConsecutiveMissedCheckins } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) { skipped++; continue; }

      const maxWeeks = getMaxWeeks(client.program);
      if (weekNo > maxWeeks) { skipped++; continue; }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) { skipped++; continue; }

      await checkConsecutiveMissedCheckins(client.id);

      const token = generateToken(client.id, weekNo);
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}&t=${token}`;
      const market = client.leads?.market || 'GLOBAL';

      const msg = isHinglishMarket(market)
        ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in time!\n\nApna progress update karo:\n${checkinUrl}\n\nWeight, waist, photos aur energy level submit karo.`
        : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in!\n\nUpdate your progress here:\n${checkinUrl}\n\nSubmit your weight, waist, photos and energy level.`;

      await sendWhatsApp(client.phone, msg, 'weekly_checkin', true);
      sent++;
    }

    return res.status(200).json({ ok: true, sent, skipped });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function calculateWeekNo(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function getMaxWeeks(program) {
  const map = { '6wk_gym': 6, '6wk_home': 6, pcos: 6, '40plus': 6, '12wk': 12, zoom_trial: 1, zoom_pack: 4 };
  return map[program] || 6;
}

function generateToken(clientId, weekNo) {
  const secret = process.env.CHECKIN_TOKEN_SECRET || process.env.SUPABASE_SERVICE_KEY;
  return crypto.createHmac('sha256', secret).update(`${clientId}:${weekNo}`).digest('hex').slice(0, 16);
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
