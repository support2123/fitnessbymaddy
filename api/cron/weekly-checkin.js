const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/market');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthed = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;

  if (!isVercelCron && !isAuthed) {
    return res.status(401).json({ error: 'Unauthorized' });
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
  let escalated = 0;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) continue;

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (existing && existing.length > 0) continue;

    const { data: missedWeeks } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const submittedWeeks = missedWeeks ? missedWeeks.map(c => c.week_no) : [];
    const lastTwoMissed = weekNo >= 3
      && !submittedWeeks.includes(weekNo - 1)
      && !submittedWeeks.includes(weekNo - 2);

    if (lastTwoMissed) {
      await escalateToMaddy({
        reason: '2 consecutive missed check-ins',
        phone: client.phone,
        details: `Client: ${client.name || 'Unknown'}, Program: ${client.program}, Week: ${weekNo}`
      });
      escalated++;
    }

    const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
    const market = detectMarket(client.phone);
    const isHinglish = market === 'IN';

    const msg = isHinglish
      ? `Hey ${client.name || 'Champion'}! 📊 Week ${weekNo} check-in time!\n\nApna progress update karo:\n${checkinUrl}\n\nWeight, waist, photos aur mood — sab bharo. 💪`
      : `Hey ${client.name || 'Champion'}! 📊 It's Week ${weekNo} check-in time!\n\nUpdate your progress:\n${checkinUrl}\n\nWeight, waist, photos and mood — fill it all in. 💪`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_checkin',
      body: msg,
      params: [client.name || 'Champion', String(weekNo), checkinUrl]
    });

    sent++;
  }

  return res.status(200).json({ message: 'Weekly check-ins sent', sent, escalated });
};
