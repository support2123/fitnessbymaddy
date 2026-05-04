const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
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

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://fitnessbymaddy.com';
    const now = new Date();
    let sent = 0;
    const errors = [];

    for (const client of clients) {
      try {
        if (client.program_ends_at && now > new Date(client.program_ends_at)) {
          await supabase.from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);
          continue;
        }

        const started = new Date(client.program_started_at);
        const diffDays = Math.floor((now - started) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(diffDays / 7) + 1;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const formUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          formUrl
        ]);
        sent++;
      } catch (clientErr) {
        errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    return res.status(200).json({ ok: true, sent, errors: errors.length ? errors : undefined });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
