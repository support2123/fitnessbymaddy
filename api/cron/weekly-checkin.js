const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  const { data: clients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return res.json({ sent: 0, nudged: 0 });
  }

  let sent = 0;
  let nudged = 0;

  for (const client of clients) {
    if (client.program_ends_at && now > new Date(client.program_ends_at)) continue;

    const startDate = new Date(client.program_started_at);
    const weekNo = Math.max(1, Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000)));

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);

    if (!existing || existing.length === 0) {
      const { data: sentMsgs } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', client.phone)
        .eq('template_name', 'weekly_checkin')
        .order('sent_at', { ascending: false })
        .limit(1);

      const lastSent = sentMsgs?.[0]?.sent_at ? new Date(sentMsgs[0].sent_at) : null;
      const hoursSinceSent = lastSent ? (now - lastSent) / (1000 * 60 * 60) : Infinity;

      if (!lastSent || hoursSinceSent > 160) {
        const body = hinglish
          ? `Hey ${client.name || 'there'}! \u{1F4CB} Week ${weekNo} check-in time!\n\nWeight, waist, photos aur progress share karo:\n${checkinUrl}\n\nYeh important hai progress track karne ke liye! \u{1F4AA}`
          : `Hey ${client.name || 'there'}! \u{1F4CB} Time for your Week ${weekNo} check-in!\n\nShare your weight, waist, photos and progress:\n${checkinUrl}\n\nThis is important for tracking your progress! \u{1F4AA}`;

        await sendWhatsApp({ phone: client.phone, templateName: 'weekly_checkin', body });
        sent++;
      } else if (hoursSinceSent >= 24 && hoursSinceSent < 26) {
        const body = hinglish
          ? `Reminder: Week ${weekNo} check-in abhi tak pending hai \u{23F0}\n\n${checkinUrl}\n\n2 min lagenge — tera progress track karna zaroori hai!`
          : `Reminder: Your Week ${weekNo} check-in is still pending \u{23F0}\n\n${checkinUrl}\n\nTakes 2 minutes — tracking progress is key!`;

        await sendWhatsApp({ phone: client.phone, templateName: 'checkin_nudge', body });
        nudged++;
      } else if (hoursSinceSent >= 48 && hoursSinceSent < 50) {
        const body = hinglish
          ? `Last reminder! Week ${weekNo} check-in karo toh hum tera next week ka plan bana sakein \u{1F4AA}\n\n${checkinUrl}`
          : `Last reminder! Complete your Week ${weekNo} check-in so we can build your next week's plan \u{1F4AA}\n\n${checkinUrl}`;

        await sendWhatsApp({ phone: client.phone, templateName: 'checkin_final_nudge', body });
        nudged++;
      }

      // 2 consecutive missed check-ins → escalate
      if (weekNo >= 2) {
        const { data: prevCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo - 1)
          .limit(1);

        if ((!prevCheckin || prevCheckin.length === 0) && hoursSinceSent >= 48) {
          await escalateToMaddy({
            reason: '2 consecutive missed check-ins',
            phone: client.phone,
            message: `Weeks ${weekNo - 1} and ${weekNo} — no submissions`,
            clientName: client.name,
          });
        }
      }
    }
  }

  res.json({ sent, nudged });
};
