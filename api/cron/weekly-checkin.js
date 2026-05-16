const { supabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ sent: 0 });
    }

    let sentCount = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        const msg = client.phone.startsWith('91')
          ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in time 📋\n\nApna progress update karo: ${checkinUrl}\n\nWeight, waist, photos + how you're feeling — sab share karo!`
          : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in 📋\n\nUpdate your progress here: ${checkinUrl}\n\nShare weight, waist, photos + how you're feeling!`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          params: [msg],
        });

        sentCount++;
      } catch (err) {
        errors.push({ client_id: client.id, error: err.message });
      }
    }

    if (errors.length > 0) {
      await notifyMaddy(`Weekly check-in cron: ${sentCount} sent, ${errors.length} errors`);
    }

    return res.status(200).json({ sent: sentCount, errors: errors.length });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
