const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { getLanguage, detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sentCount = 0;

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

      const market = detectMarket(client.phone);
      const lang = getLanguage(market);
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const msg = lang === 'hinglish'
        ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in time. Apna progress track karo:\n\n${checkinUrl}\n\nWeight, waist, photos, aur kaise feel kar rahe ho — sab fill karo.`
        : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Track your progress here:\n\n${checkinUrl}\n\nFill in your weight, waist, photos, and how you're feeling.`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: msg,
        params: [client.name || 'there', String(weekNo)]
      });

      sentCount++;
    }

    return res.status(200).json({ success: true, sent: sentCount });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
