const { supabase } = require('../lib/supabase');
const { sendTextMessage, sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret (Vercel sends this header for cron jobs)
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) { skipped++; continue; }

      // Check if already submitted this week
      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) { skipped++; continue; }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const market = client.phone.startsWith('91') ? 'IN' : 'GLOBAL';
      const text = market === 'IN'
        ? `Hey ${client.name || 'there'}! 📋 Week ${weekNo} check-in time!\n\nForm fill karo: ${checkinUrl}\n\nWeight, waist measurement, aur photos upload karna mat bhoolna 💪`
        : `Hey ${client.name || 'there'}! 📋 Time for your Week ${weekNo} check-in!\n\nFill it here: ${checkinUrl}\n\nDon't forget weight, waist measurement, and progress photos 💪`;

      await sendTextMessage(client.phone, text);
      sent++;
    }

    return res.status(200).json({ success: true, sent, skipped, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
