const { getSupabase } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ sent: 0, message: 'No active clients' });
    }

    let sent = 0;
    const errors = [];

    for (const client of clients) {
      try {
        const { data: lastCheckin } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1)
          .single();

        const nextWeek = lastCheckin ? lastCheckin.week_no + 1 : 1;

        const startedAt = new Date(client.program_started_at);
        const maxWeeks = client.program === '12wk' ? 12 : 6;
        if (nextWeek > maxWeeks) continue;

        const { count: missedCount } = await db
          .from('checkins')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id);

        const expectedCheckins = nextWeek - 1;
        const actualCheckins = missedCount || 0;
        const consecutiveMissed = expectedCheckins - actualCheckins;

        if (consecutiveMissed >= 2) {
          await escalateToMaddy('2 consecutive missed check-ins', client.phone, `Client ${client.name || client.id} missed ${consecutiveMissed} check-ins`);
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${nextWeek}`;
        const market = detectClientMarket(client.phone);
        const hinglish = isHinglish(market);

        let msg;
        if (hinglish) {
          msg = `Hey ${client.name || 'there'}! 💪 Week ${nextWeek} check-in time!\n\n` +
                `Apna progress share karo:\n${checkinUrl}\n\n` +
                `Weight, waist, compliance score aur photos submit karo. Keep going! 🔥`;
        } else {
          msg = `Hey ${client.name || 'there'}! 💪 Time for your Week ${nextWeek} check-in!\n\n` +
                `Submit your progress here:\n${checkinUrl}\n\n` +
                `Share your weight, waist, compliance score and photos. You've got this! 🔥`;
        }

        await sendText(client.phone, msg);
        sent++;

        scheduleNudges(client, nextWeek, checkinUrl, hinglish);
      } catch (e) {
        errors.push({ client_id: client.id, error: e.message });
      }
    }

    return res.json({ sent, total: clients.length, errors: errors.length > 0 ? errors : undefined });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectClientMarket(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

function scheduleNudges(client, weekNo, checkinUrl, hinglish) {
  const oneDay = 24 * 60 * 60 * 1000;
  const twoDays = 2 * oneDay;
  const db = getSupabase();

  setTimeout(async () => {
    try {
      const { data } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (!data || data.length === 0) {
        const msg = hinglish
          ? `Reminder: Week ${weekNo} check-in abhi submit nahi hua hai! 📋\n${checkinUrl}`
          : `Reminder: Your Week ${weekNo} check-in is still pending! 📋\n${checkinUrl}`;
        await sendText(client.phone, msg);
      }
    } catch (e) { console.error('Nudge +24h error:', e.message); }
  }, oneDay);

  setTimeout(async () => {
    try {
      const { data } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (!data || data.length === 0) {
        const msg = hinglish
          ? `Last reminder! Week ${weekNo} check-in fill karo, progress track karna zaroori hai 🙏\n${checkinUrl}`
          : `Final reminder! Please submit your Week ${weekNo} check-in to keep your progress on track 🙏\n${checkinUrl}`;
        await sendText(client.phone, msg);
      }
    } catch (e) { console.error('Nudge +48h error:', e.message); }
  }, twoDays);
}
