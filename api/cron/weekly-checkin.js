const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { logMessage } = require('../../lib/rate-limit');
const { detectMarket, isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return res.status(200).json({ ok: true, sent: 0 });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    const { data: lastCheckin } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const lastWeekSubmitted = lastCheckin?.week_no || 0;

    if (lastWeekSubmitted >= currentWeek) continue;

    if (currentWeek - lastWeekSubmitted >= 3) {
      await escalateToMaddy(
        `2+ consecutive missed check-ins (last: week ${lastWeekSubmitted}, current: week ${currentWeek})`,
        client
      );
      escalated++;
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const templateName = hinglish ? 'weekly_checkin_hi' : 'weekly_checkin_en';

    await sendTemplate(client.phone, templateName, [
      client.name || 'there',
      `${currentWeek}`,
      checkinUrl,
    ]);
    await logMessage(
      client.phone, 'out',
      `[template:${templateName}] Week ${currentWeek} check-in`,
      templateName
    );
    sent++;
  }

  return res.status(200).json({ ok: true, sent, escalated, total_clients: clients.length });
};
