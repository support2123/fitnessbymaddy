const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ sent: 0, message: 'No active clients' });
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

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);
        sent++;

        // Check for 2 consecutive missed check-ins
        if (weekNo >= 3) {
          const { data: recent } = await supabase
            .from('checkins')
            .select('week_no')
            .eq('client_id', client.id)
            .order('week_no', { ascending: false })
            .limit(1);

          const lastSubmitted = recent?.[0]?.week_no || 0;
          if (weekNo - lastSubmitted >= 2) {
            await supabase.from('escalations').insert({
              phone: client.phone,
              reason: '2_consecutive_missed_checkins',
              message_body: `${client.name || 'Client'} missed weeks ${lastSubmitted + 1}-${weekNo}`
            });
            await sendTemplate(process.env.MADDY_PHONE, 'escalation_alert', [
              client.name || 'Client', '2 missed check-ins'
            ]);
          }
        }
      } catch (err) {
        errors.push({ client_id: client.id, error: err.message });
      }
    }

    return res.status(200).json({ sent, total: clients.length, errors });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
