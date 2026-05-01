const { getSupabase } = require('../../lib/supabase');
const { isHinglish } = require('../../lib/helpers');
const { sendTemplate, sendText, notifyMaddy } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: clients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return res.json({ ok: true, processed: 0 });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) continue;

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existing) continue;

    const { data: missed } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const missedWeeks = missed || [];
    const lastSubmittedWeek = missedWeeks.length > 0 ? missedWeeks[0].week_no : 0;
    const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

    if (consecutiveMissed >= 2) {
      await notifyMaddy(
        '2 consecutive missed check-ins',
        `Client: ${client.name} (${client.phone})\nProgram: ${client.program}\nLast check-in: Week ${lastSubmittedWeek}\nCurrent week: ${weekNo}`
      );
      escalated++;
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
    const market = client.phone?.startsWith('+91') ? 'IN' : 'GLOBAL';

    if (isHinglish(market)) {
      await sendText(client.phone,
        `Hey ${client.name || ''}! Week ${weekNo} ka check-in time aa gaya. Apna progress update karo:\n${checkinUrl}`
      );
    } else {
      await sendText(client.phone,
        `Hey ${client.name || ''}! Time for your Week ${weekNo} check-in. Update your progress here:\n${checkinUrl}`
      );
    }

    sent++;
  }

  return res.json({ ok: true, sent, escalated, total: clients.length });
};
