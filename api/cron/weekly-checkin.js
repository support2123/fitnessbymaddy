const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { notifyMaddy } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / 86400000);
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { data: missedWeeks } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastSubmittedWeek = missedWeeks?.[0]?.week_no || 0;
      const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${maskPhone(client.phone)}\nProgram: ${client.program}\nLast submitted: Week ${lastSubmittedWeek}`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.market || 'IN';
      const templateName = isHinglish(market) ? 'checkin_reminder_hi' : 'checkin_reminder_en';

      await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        String(weekNo),
        checkinUrl
      ]);

      sent++;
    }

    return res.json({ ok: true, sent, escalated, total_clients: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
