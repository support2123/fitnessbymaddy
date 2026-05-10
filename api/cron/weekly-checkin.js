const { supabase } = require('../../lib/supabase');
const { sendText, notifyMaddy } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ sent: 0, message: 'No active clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / 86400000);
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { data: missedWeeks } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastSubmitted = missedWeeks && missedWeeks.length > 0 ? missedWeeks[0].week_no : 0;
      const consecutiveMissed = weekNo - lastSubmitted - 1;

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          `2 consecutive missed check-ins — ${maskPhone(client.phone)}`,
          `Client: ${client.name}\nProgram: ${client.program}\nLast check-in: Week ${lastSubmitted}\nCurrent: Week ${weekNo}`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const msg = isHinglish(market)
        ? `Hey ${client.name || 'there'}! Week ${weekNo} ka check-in time aa gaya. Apna progress update karo: ${checkinUrl}`
        : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Update your progress here: ${checkinUrl}`;

      try {
        await sendText(client.phone, msg);
        sent++;
      } catch (e) {
        console.error(`Failed to send checkin to ${maskPhone(client.phone)}:`, e.message);
      }
    }

    return res.json({ sent, escalated, total_clients: activeClients.length });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
