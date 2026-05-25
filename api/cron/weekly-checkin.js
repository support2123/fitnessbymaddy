const { supabase } = require('../_lib/supabase');
const { sendTemplate, canSendMessage } = require('../_lib/whatsapp');
const { checkMissedCheckins } = require('../_lib/escalation');
const { getLanguage } = require('../_lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of clients) {
      const weeksElapsed = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksElapsed < 1) {
        skipped++;
        continue;
      }

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weeksElapsed)
        .single();

      if (existingCheckin) {
        skipped++;
        continue;
      }

      await checkMissedCheckins(client.id, client.phone);

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weeksElapsed}`;
      const market = client.leads?.market || 'GLOBAL';
      const lang = getLanguage(market);

      if (lang === 'hinglish') {
        await sendTemplate(client.phone, 'weekly_checkin_hi', [
          client.name || 'there',
          String(weeksElapsed),
          checkinUrl,
        ]);
      } else {
        await sendTemplate(client.phone, 'weekly_checkin_en', [
          client.name || 'there',
          String(weeksElapsed),
          checkinUrl,
        ]);
      }

      sent++;
    }

    return res.status(200).json({ sent, skipped, total: clients.length });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
