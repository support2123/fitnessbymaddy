const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Verify Vercel cron authorization
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    // Get all active clients
    const { data: clients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ ok: true, sent: 0 });
    }

    let sent = 0;

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysDiff / 7);

      if (weekNo < 1) continue;

      // Check if already submitted this week
      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const template = market === 'IN' ? 'weekly_checkin_hindi' : 'weekly_checkin';

      await sendTemplate(client.phone, template, [
        client.name || 'there',
        String(weekNo),
        checkinUrl
      ]);

      sent++;

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    return res.json({ ok: true, sent, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
