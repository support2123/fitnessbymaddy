const supabase = require('../../lib/supabase');
const { sendText, sendTemplate, notifyMaddy } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ status: 'no_active_clients' });
    }

    let sent = 0;
    let skipped = 0;
    const escalations = [];

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) {
        skipped++;
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        skipped++;
        continue;
      }

      const { count: missedCount } = await supabase
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2)
        .lte('week_no', weekNo - 1);

      const expectedCheckins = Math.min(weekNo - 1, 2);
      const actualMissed = expectedCheckins - (missedCount || 0);

      if (actualMissed >= 2) {
        escalations.push(client);
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      if (isHinglish(market)) {
        await sendText(client.phone,
          `Hey ${client.name || 'Champion'}! 💪\n\n` +
          `Week ${weekNo} ka check-in time hai! Apna progress share karo:\n` +
          `📋 ${checkinUrl}\n\n` +
          `Weight, waist, photos aur feeling — sab bhar dena. Maddy review karegi! 🔥`
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'Champion'}! 💪\n\n` +
          `Time for your Week ${weekNo} check-in! Share your progress:\n` +
          `📋 ${checkinUrl}\n\n` +
          `Fill in your weight, waist, photos and how you're feeling. Maddy will review! 🔥`
        );
      }

      sent++;
    }

    for (const client of escalations) {
      await notifyMaddy(
        '2 consecutive missed check-ins',
        `Client: ${client.name || 'Unknown'}\nPhone: ${client.phone}\nProgram: ${client.program}`
      );
    }

    return res.status(200).json({
      status: 'done',
      sent,
      skipped,
      escalations: escalations.length
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
