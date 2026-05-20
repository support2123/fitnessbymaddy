const { supabase } = require('../../lib/supabase');
const { sendText } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ sent: 0 });
    }

    let sent = 0;

    for (const client of clients) {
      const weeksElapsed = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksElapsed < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weeksElapsed)
        .single();

      if (existing) continue;

      await checkMissedCheckins(client.id, client.phone);

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksElapsed}`;
      const market = detectMarket(client.phone);

      if (isHinglish(market)) {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! 📋 Week ${weeksElapsed} check-in time!\n\n` +
          `Apna progress update kar — weight, measurements, aur photos.\n\n` +
          `👉 ${checkinUrl}\n\n` +
          `Consistency hi real transformation ka secret hai 💪`
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! 📋 Time for your Week ${weeksElapsed} check-in!\n\n` +
          `Update your progress — weight, measurements, and photos.\n\n` +
          `👉 ${checkinUrl}\n\n` +
          `Consistency is the secret to real transformation 💪`
        );
      }

      sent++;
    }

    return res.status(200).json({ sent });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
