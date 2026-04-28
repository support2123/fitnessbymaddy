const { getSupabase } = require('../lib/supabase');
const { sendText, escalateToMaddy, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ status: 'ok', message: 'No active clients' });
    }

    const results = [];

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

      if (existingCheckin) {
        results.push({ client_id: client.id, status: 'already_submitted' });
        continue;
      }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastTwoWeeks = [currentWeek - 1, currentWeek - 2];
      const missedConsecutive = lastTwoWeeks.every(
        w => w > 0 && !missedCheckins?.some(c => c.week_no === w)
      );

      if (missedConsecutive && currentWeek > 2) {
        await escalateToMaddy(
          client.phone,
          '2 consecutive missed check-ins',
          `Client ${client.name} (${maskPhone(client.phone)}) missed weeks ${currentWeek - 2} and ${currentWeek - 1}`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const market = client.phone?.startsWith('+91') ? 'IN' : 'GLOBAL';
      const msg = market === 'IN'
        ? `Hey ${client.name}! Week ${currentWeek} ka check-in time hai. Ye form fill karo:\n${checkinUrl}\n\nWeight, waist, photos aur apna feedback share karo!`
        : `Hey ${client.name}! Time for your Week ${currentWeek} check-in:\n${checkinUrl}\n\nShare your weight, measurements, photos and feedback!`;

      await sendText(client.phone, msg);
      results.push({ client_id: client.id, week: currentWeek, status: 'sent' });
    }

    return res.status(200).json({ status: 'ok', results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
