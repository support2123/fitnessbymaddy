const { supabase } = require('../_lib/supabase');
const { sendText } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const client of clients) {
      try {
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
          .single();

        if (existing) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const market = client.phone.startsWith('+91') ? 'IN' : 'GLOBAL';

        const msg = market === 'IN'
          ? `Hey ${client.name || ''} 👋 Week ${weekNo} ka check-in time! Apna progress update karo:\n\n${checkinUrl}\n\nPhotos + weight + waist measurement zaroor daalna 📸`
          : `Hey ${client.name || ''} 👋 Time for your Week ${weekNo} check-in! Update your progress:\n\n${checkinUrl}\n\nDon't forget photos + weight + waist measurement 📸`;

        await sendText(client.phone, msg, true);
        sent++;
      } catch (clientErr) {
        errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    return res.status(200).json({ ok: true, sent, total: clients.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
