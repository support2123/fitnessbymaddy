const { supabase } = require('../../lib/supabase');
const { sendText } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');
const { maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastCheckedWeek = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = weekNo - lastCheckedWeek - 1;

      if (consecutiveMissed >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          `Client ${maskPhone(client.phone)} (${client.name || 'unknown'}) — ${consecutiveMissed} weeks missed`
        );
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! 💪 Week ${weekNo} check-in time!\n\nApna progress fill karo: ${checkinUrl}\n\nWeight, waist, photos daalke bata — program next week accordingly adjust karenge.`
        : `Hey ${client.name || 'there'}! 💪 Time for your Week ${weekNo} check-in!\n\nFill it here: ${checkinUrl}\n\nShare your weight, waist, photos — we'll adjust your program for next week.`;

      await sendText(client.phone, msg);
      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-ins sent',
      total_clients: activeClients.length,
      sent,
      escalated,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
