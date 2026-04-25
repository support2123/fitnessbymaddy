const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, canSendTo } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ ok: true, sent: 0, message: 'No active clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) {
        skipped++;
        continue;
      }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        skipped++;
        continue;
      }

      const formUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      const allowed = await canSendTo(client.phone);
      if (!allowed) {
        skipped++;
        continue;
      }

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        bodyValues: [
          client.name || 'there',
          String(weekNo),
          formUrl,
        ],
      });

      sent++;
    }

    return res.json({ ok: true, sent, skipped, total: activeClients.length });
  } catch (err) {
    console.error('[Cron/Checkin] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startedAt) {
  if (!startedAt) return 0;
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
