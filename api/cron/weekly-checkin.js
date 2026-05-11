const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.json({ success: true, sent: 0, message: 'No active clients' });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(daysSinceStart / 7) + 1;

        const maxWeeks = client.program === '12wk' ? 12 : client.program === 'zoom_trial' ? 1 : 6;
        if (weekNo > maxWeeks) continue;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const formUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        const isHinglish = market === 'IN';

        const msg = isHinglish
          ? `Hey ${client.name || ''}! 📋 Week ${weekNo} ka check-in time aa gaya hai!\n\nYe form fill karo (2 min lagega):\n${formUrl}\n\nWeight, waist, photos, aur apna feedback daalo. Ye Maddy ko aapka next plan banana mein help karega 💪`
          : `Hey ${client.name || ''}! 📋 It's time for your Week ${weekNo} check-in!\n\nFill out this form (takes 2 min):\n${formUrl}\n\nShare your weight, waist, photos, and feedback. This helps Maddy build your next week's plan 💪`;

        await sendWhatsApp({ phone: client.phone, body: msg });
        sent++;

        await delay(500);
      } catch (err) {
        errors.push({ client_id: client.id, error: err.message });
      }
    }

    return res.json({ success: true, sent, total: activeClients.length, errors });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
