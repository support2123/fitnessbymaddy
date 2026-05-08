const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket, isHinglish, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const db = getSupabase();

  const { data: activeClients, error } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (error) {
    console.error('Fetch active clients error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  const results = { sent: 0, skipped: 0, escalated: 0 };

  for (const client of activeClients || []) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) {
      results.skipped++;
      continue;
    }

    const { data: lastCheckin } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const lastWeek = lastCheckin?.week_no || 0;

    if (lastWeek >= currentWeek) {
      results.skipped++;
      continue;
    }

    const missedConsecutive = currentWeek - lastWeek;
    if (missedConsecutive >= 3) {
      await escalateToMaddy('2+ consecutive missed check-ins', {
        name: client.name,
        phone: maskPhone(client.phone),
        details: `Missed ${missedConsecutive - 1} weeks. Last check-in: Week ${lastWeek}`,
      });
      results.escalated++;
    }

    const market = detectMarket(client.phone);
    const templateName = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin';
    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

    await sendTemplate(client.phone, templateName, [
      client.name || 'there',
      String(currentWeek),
      checkinUrl,
    ]);
    await logMessage(client.phone, 'out', `Week ${currentWeek} check-in reminder`, templateName);
    results.sent++;
  }

  return res.status(200).json({ success: true, ...results });
};
