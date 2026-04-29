const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sends this header)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .not('program_started_at', 'is', null);

    if (!activeClients || activeClients.length === 0) {
      return res.json({ sent: 0, message: 'No active clients' });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const maxWeeks = client.program === '12wk' ? 12 : 6;
        if (weekNo > maxWeeks) {
          await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
          continue;
        }

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        if (await canSendMessage(client.phone)) {
          await sendTemplate(client.phone, 'weekly_checkin', [
            client.name || 'there',
            String(weekNo),
            checkinUrl,
          ]);
          sent++;
        }
      } catch (clientErr) {
        errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    return res.json({ sent, total: activeClients.length, errors });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
