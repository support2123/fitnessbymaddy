const { supabase } = require('../_lib/supabase');
const { sendText, sendTemplate } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');
const { checkMissedCheckins } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'] || '';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isVercel = req.headers['x-vercel-cron'] === '1';
  if (!isCron && !isVercel) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';
      const checkinUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;

      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! 📊 Week ${weekNo} check-in ka time hai.\n\nYeh form fill karo (2 min lagega):\n${checkinUrl}\n\nWeight, waist, photos, aur kaise feel kar rahe ho — sab batao!`
        : `Hey ${client.name || 'there'}! 📊 Time for your Week ${weekNo} check-in.\n\nFill this form (takes 2 mins):\n${checkinUrl}\n\nUpdate your weight, waist, photos, and how you're feeling!`;

      await sendText(client.phone, msg);
      sent++;
    }

    await checkMissedCheckins(supabase);

    return res.status(200).json({ ok: true, sent, total_clients: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
