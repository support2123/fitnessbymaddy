const { getSupabase, TABLES } = require('../_utils/supabase');
const { sendTemplate } = require('../_utils/whatsapp');
const { isHinglish, detectMarket } = require('../_utils/helpers');
const { notifyMaddy } = require('../_utils/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from(TABLES.CLIENTS)
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: lastCheckins } = await db
        .from(TABLES.CHECKINS)
        .select('week_no, form_submitted_at')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const missedConsecutive = checkConsecutiveMisses(lastCheckins || [], currentWeek);
      if (missedConsecutive >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name} (${client.phone})\nProgram: ${client.program}\nWeek: ${currentWeek}`
        );
        escalated++;
      }

      const alreadySubmitted = lastCheckins && lastCheckins.some(
        (c) => c.week_no === currentWeek && c.form_submitted_at
      );

      if (alreadySubmitted) continue;

      const market = (client.leads && client.leads.market) || detectMarket(client.phone);
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const templateName = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin_en';

      await sendTemplate(client.phone, templateName, [
        client.name || 'Champion',
        `${currentWeek}`,
        checkinUrl,
      ]);

      sent++;
    }

    return res.status(200).json({ message: 'Weekly check-in sent', sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function checkConsecutiveMisses(checkins, currentWeek) {
  let misses = 0;
  for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - 2); w--) {
    const found = checkins.find((c) => c.week_no === w && c.form_submitted_at);
    if (!found) misses++;
    else break;
  }
  return misses;
}
