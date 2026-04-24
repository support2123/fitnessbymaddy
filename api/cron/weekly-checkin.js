const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, detectMarket, isHinglish } = require('../../lib/whatsapp');
const { json } = require('../../lib/utils');
const { escalateToMaddy } = require('../../lib/escalate');
const { maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return json(res, 200, { ok: true, processed: 0 });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of activeClients) {
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

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
    const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

    if (consecutiveMissed >= 2) {
      await escalateToMaddy(
        '2 consecutive missed check-ins',
        `Client: ${maskPhone(client.phone)}\nName: ${client.name}\nProgram: ${client.program}\nLast submitted: Week ${lastSubmittedWeek}`
      );
      escalated++;
    }

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

    const msg = hinglish
      ? [`Week ${weekNo} check-in time! Apna progress share karo: ${formUrl}`]
      : [`Time for your Week ${weekNo} check-in! Share your progress: ${formUrl}`];

    await sendTemplate(client.phone, 'weekly_checkin', msg);
    sent++;
  }

  return json(res, 200, { ok: true, sent, escalated, total: activeClients.length });
};
