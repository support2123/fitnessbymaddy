const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let nudged = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: lastCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const lastWeekSubmitted = lastCheckin ? lastCheckin.week_no : 0;

      if (lastWeekSubmitted >= currentWeek) continue;

      const missedWeeks = currentWeek - lastWeekSubmitted - 1;
      if (missedWeeks >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name || maskPhone(client.phone)}\nMissed weeks: ${missedWeeks}\nProgram: ${client.program}`
        );
        escalated++;
      }

      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);
      const formUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! Week ${currentWeek} check-in time. Form yahan fill karo: ${formUrl}`
        : `Hey ${client.name || 'there'}! Time for your Week ${currentWeek} check-in: ${formUrl}`;

      await sendText(client.phone, msg);
      sent++;
    }

    return res.status(200).json({ action: 'weekly_checkin_sent', sent, nudged, escalated });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
