const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return res.status(200).json({ ok: true, sent: 0 });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) continue;

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (existing && existing.length > 0) continue;

    const { data: missed } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const lastCheckinWeek = missed?.[0]?.week_no || 0;
    const consecutiveMissed = weekNo - lastCheckinWeek - 1;

    if (consecutiveMissed >= 2) {
      await notifyMaddy(
        '2 consecutive missed check-ins',
        `Client: ${client.name || client.phone}\nProgram: ${client.program}\nLast check-in: Week ${lastCheckinWeek}`
      );
      escalated++;
    }

    const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

    const market = client.phone.startsWith('+91') || client.phone.startsWith('91') ? 'IN' : 'GLOBAL';
    if (market === 'IN') {
      await sendText(client.phone,
        `Hey ${client.name || 'there'}! Week ${weekNo} check-in time 📊\n\n` +
        `Form fill karo (2 min): ${formUrl}\n\n` +
        `Photos + measurements dena — program accordingly adjust hoga!`
      );
    } else {
      await sendText(client.phone,
        `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in 📊\n\n` +
        `Fill this out (2 min): ${formUrl}\n\n` +
        `Include photos + measurements — I'll adjust your program accordingly!`
      );
    }
    sent++;
  }

  return res.status(200).json({ ok: true, sent, escalated });
};
