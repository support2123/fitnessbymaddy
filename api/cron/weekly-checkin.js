const { supabase } = require('../../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ ok: true, sent: 0 });
    }

    let sent = 0;
    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const market = detectMarket(client.phone);
      const template = market === 'IN' ? 'checkin_reminder_hi' : 'checkin_reminder_en';
      const formUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp(client.phone, template, [
        client.name || 'there',
        `Week ${weekNo}`,
        formUrl
      ]);

      sent++;

      if (sent % 10 === 0) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return res.json({ ok: true, sent, total_clients: clients.length });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
