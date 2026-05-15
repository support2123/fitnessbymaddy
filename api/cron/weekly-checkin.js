const { getSupabase } = require('../../lib/supabase');
const { sendText, maskPhone } = require('../../lib/whatsapp');
const { logMessage } = require('../../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isService = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;
  if (!isCron && !isService) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const msg = `Hey ${client.name || 'there'}! 📋 Time for your Week ${weekNo} check-in.\n\n` +
        `Fill it out here: ${formUrl}\n\n` +
        `It takes 2 minutes and helps us customize your next week!`;

      try {
        await sendText(client.phone, msg);
        await logMessage(client.phone, 'out', msg, 'weekly_checkin_reminder');
        sent++;
      } catch (sendErr) {
        console.error(`[Checkin Remind] Failed for ${maskPhone(client.phone)}:`, sendErr.message);
      }
    }

    return res.status(200).json({ ok: true, sent, total: activeClients.length });
  } catch (err) {
    console.error('[Weekly Checkin Cron Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
