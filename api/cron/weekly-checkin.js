const { getSupabase } = require('../../lib/supabase');
const { sendText, sendTemplate, maskPhone } = require('../../lib/whatsapp');
const { logMessage } = require('../../lib/rate-limit');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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

    let sent = 0;
    const now = new Date();

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in time. Apna progress update karo:\n${checkinUrl}\n\nWeight, waist, compliance aur photos dalna mat bhoolna.`
        : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Update your progress here:\n${checkinUrl}\n\nDon't forget weight, waist, compliance, and photos.`;

      await sendText(client.phone, msg);
      await logMessage({
        phone: client.phone,
        direction: 'out',
        body: msg,
        templateName: 'weekly_checkin',
      });
      sent++;
    }

    return res.status(200).json({ message: 'Weekly check-ins sent', sent });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
