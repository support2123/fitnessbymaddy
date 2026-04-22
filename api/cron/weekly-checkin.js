const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: clients } = await db
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ message: 'No active clients', sent: 0 });
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

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        const formUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;

        const market = client.leads?.market || 'GLOBAL';
        const template = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin_en';

        await sendTemplate(client.phone, template, [
          client.name || 'there',
          String(weekNo),
          formUrl,
        ]);

        sent++;
      } catch (err) {
        errors.push({ client_id: client.id, error: err.message });
      }
    }

    return res.json({ sent, total: clients.length, errors: errors.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
