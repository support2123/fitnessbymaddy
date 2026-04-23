const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    // Allow in dev without CRON_SECRET
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    const now = new Date();
    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (24 * 60 * 60 * 1000));
        const currentWeek = Math.floor(daysSinceStart / 7) + 1;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existing) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
        const market = detectMarket(client.phone);

        const message = market === 'IN'
          ? `Hey ${client.name || 'there'}! Week ${currentWeek} check-in time 📋\n\nApna progress update karo: ${checkinUrl}\n\nWeight, waist, photos aur energy level fill karo. Yeh plan ko better banane mein help karega 💪`
          : `Hey ${client.name || 'there'}! Time for your Week ${currentWeek} check-in 📋\n\nUpdate your progress here: ${checkinUrl}\n\nFill in your weight, waist, photos, and energy levels. This helps us tailor your plan 💪`;

        await sendWhatsApp(client.phone, message, 'weekly_checkin');
        sent++;
      } catch (e) {
        errors.push({ client_id: client.id, error: e.message });
        console.error(`Check-in send failed for ${maskPhone(client.phone)}: ${e.message}`);
      }
    }

    return res.status(200).json({
      message: `Weekly check-in sent to ${sent} clients`,
      sent,
      total: activeClients.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
