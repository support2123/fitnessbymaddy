const { supabase } = require('../../lib/supabase');
const { sendText } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ ok: true, message: 'No active clients', sent: 0 });
    }

    let sent = 0;

    for (const client of clients) {
      const weeksElapsed = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextWeek = lastCheckin ? lastCheckin.week_no + 1 : 1;

      if (nextWeek > weeksElapsed) continue;

      await checkMissedCheckins(client.id, client.phone);

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${nextWeek}`;
      const market = require('../../lib/market').detectMarket(client.phone);
      const hinglish = isHinglish(market);

      if (hinglish) {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! 💪 Week ${nextWeek} check-in time!\n\n` +
          `Apna progress update karo — weight, photos, aur kaise feel kar rahe ho:\n` +
          `📋 ${checkinUrl}\n\n` +
          `Consistency is key! 🔑`
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! 💪 Time for your Week ${nextWeek} check-in!\n\n` +
          `Update your progress — weight, photos, and how you're feeling:\n` +
          `📋 ${checkinUrl}\n\n` +
          `Consistency is key! 🔑`
        );
      }

      sent++;
    }

    return res.json({ ok: true, sent });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
