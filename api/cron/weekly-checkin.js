const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      const { count: missedCount } = await db
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id);

      const expectedCheckins = currentWeek - 1;
      const consecutiveMissed = expectedCheckins - (missedCount || 0);

      if (consecutiveMissed >= 2) {
        await escalateToMaddy('2+ consecutive missed check-ins', {
          phone: maskPhone(client.phone),
          client_id: client.id,
          missed: consecutiveMissed,
        });
        escalated++;
      }

      const market = detectMarket(client.phone);
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      const msgParams = isHinglish(market)
        ? [`Week ${currentWeek} ka check-in time! Form fill kar do: ${checkinUrl}`]
        : [`Time for your Week ${currentWeek} check-in! Fill the form here: ${checkinUrl}`];

      await sendWhatsApp(client.phone, 'weekly_checkin', msgParams);
      sent++;
    }

    return res.json({ success: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('[cron/weekly-checkin]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
