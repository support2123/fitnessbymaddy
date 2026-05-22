const { supabase } = require('../_lib/supabase');
const { sendTemplate, canSendMessage } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('fetch clients error:', error.message);
      return res.status(500).json({ error: 'db error' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of clients || []) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) {
        skipped++;
        continue;
      }

      const endDate = new Date(client.program_ends_at);
      if (now > endDate) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        skipped++;
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existing) {
        skipped++;
        continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const market = detectMarket(client.phone);

      if (isHinglish(market)) {
        await sendTemplate(client.phone, 'checkin_reminder_hi', [
          client.name || 'there',
          currentWeek.toString(),
          checkinUrl,
        ]);
      } else {
        await sendTemplate(client.phone, 'checkin_reminder_en', [
          client.name || 'there',
          currentWeek.toString(),
          checkinUrl,
        ]);
      }

      sent++;
    }

    return res.status(200).json({ sent, skipped, total: (clients || []).length });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'cron failed' });
  }
};
