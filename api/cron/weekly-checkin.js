const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { weeksBetween, maskPhone } = require('../../lib/helpers');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;
    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let skipped = 0;
    const errors = [];

    for (const client of clients) {
      try {
        const weekNo = weeksBetween(client.program_started_at, new Date()) + 1;

        if (weekNo < 1) {
          skipped++;
          continue;
        }

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) {
          skipped++;
          continue;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);

        sent++;

        await checkMissedCheckins(client.id);
      } catch (clientErr) {
        console.error(`[Cron] Checkin send failed for ${maskPhone(client.phone)}:`, clientErr.message);
        errors.push({ phone: maskPhone(client.phone), error: clientErr.message });
      }
    }

    return res.status(200).json({
      success: true,
      total_clients: clients.length,
      sent,
      skipped,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('[Cron/WeeklyCheckin] Error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
