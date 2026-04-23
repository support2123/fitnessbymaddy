const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', now.toISOString());

    if (!clients || clients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) continue;

      const { data: lastTwo } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (lastTwo && lastTwo.length >= 2) {
        const expected = weekNo - 1;
        const secondExpected = weekNo - 2;
        const hasRecent = lastTwo.some(c => c.week_no === expected);
        const hasPrevious = lastTwo.some(c => c.week_no === secondExpected);

        if (!hasRecent && !hasPrevious) {
          await escalateToMaddy({
            reason: '2 consecutive missed check-ins',
            phone: client.phone,
            context: `Client ${client.name || client.id}, Week ${weekNo}`,
          });
          escalated++;
        }
      }

      const hinglish = isHinglish(client.market || 'GLOBAL');
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const msgBody = hinglish
        ? `Week ${weekNo} check-in time! Apna progress share karo — weight, waist, photos. Yeh important hai tracking ke liye.`
        : `Week ${weekNo} check-in time! Share your progress — weight, waist, photos. This keeps your program on track.`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        bodyValues: [msgBody, checkinUrl],
      });

      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
