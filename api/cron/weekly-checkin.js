const { getSupabase } = require('../lib/supabase');
const { sendText, notifyMaddy, maskPhone, detectMarket, isHinglish } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ status: 'ok', message: 'No active clients' });
    }

    let sent = 0;
    let skipped = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNumber(client.program_started_at);

      if (weekNo < 1) {
        skipped++;
        continue;
      }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        skipped++;
        continue;
      }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastSubmitted = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = weekNo - lastSubmitted - 1;

      if (consecutiveMissed >= 2) {
        await notifyMaddy('2 consecutive missed check-ins', {
          phone: maskPhone(client.phone),
          message: `Client ${client.name || 'Unknown'} has missed ${consecutiveMissed} consecutive check-ins (last: Week ${lastSubmitted}, current: Week ${weekNo}).`
        });
        escalated++;
      }

      const checkinLink = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? `Hey ${client.name || 'Champion'}! 📋\n\nWeek ${weekNo} ka check-in time aa gaya!\n\nApna weight, waist, photos aur progress update karo:\n${checkinLink}\n\n5 min lagega — let's track your gains! 💪`
        : `Hey ${client.name || 'Champion'}! 📋\n\nIt's time for your Week ${weekNo} check-in!\n\nUpdate your weight, waist, photos & progress:\n${checkinLink}\n\nTakes 5 minutes — let's track your gains! 💪`;

      await sendText(client.phone, msg);
      sent++;
    }

    return res.status(200).json({
      status: 'ok',
      sent,
      skipped,
      escalated,
      total: activeClients.length
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function calculateWeekNumber(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
