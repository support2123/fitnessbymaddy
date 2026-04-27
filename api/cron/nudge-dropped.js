const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../../lib/market');

const SITE_BASE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const results = { nudged_2hr: 0, dropped_24hr: 0, reengaged_7d: 0 };

    // ---- 2-hour nudge for leads that haven't replied ----
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();

    const { data: staleNew } = await db
      .from('leads')
      .select('id, phone, market')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', threeHoursAgo);

    for (const lead of staleNew || []) {
      const hinglish = isHinglish(lead.market);
      const trialUrl = `${SITE_BASE}/shred.html`;
      const msg = hinglish
        ? `Hey! 👋 Abhi tak decide nahi hua? Maddy ka $20 trial session try karo — no commitment, sirf results.\n\nDetails: ${trialUrl}`
        : `Hey! 👋 Still thinking? Try Maddy's $20 trial session — no commitment, just results.\n\nDetails: ${trialUrl}`;

      await sendWhatsApp({ phone: lead.phone, body: msg, templateName: 'nudge_trial' });
      results.nudged_2hr++;
    }

    // ---- 24-hour drop: mark as dropped ----
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();

    const { data: expired } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo)
      .gt('created_at', twentyFiveHoursAgo);

    for (const lead of expired || []) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      results.dropped_24hr++;
    }

    // ---- 7-day re-engagement for dropped leads ----
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 86400000).toISOString();

    const { data: reengageable } = await db
      .from('leads')
      .select('id, phone, market, program_interest')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    for (const lead of reengageable || []) {
      const hinglish = isHinglish(lead.market);
      const msg = hinglish
        ? `Hi again! 🙌 Maddy ki team se — abhi bhi fitness goal pe kaam karna hai? Ek free consultation ke liye reply karo. No pressure! ✨`
        : `Hi again! 🙌 From Maddy's team — still working towards your fitness goal? Reply for a free consultation. No pressure! ✨`;

      // Re-engage but mark back as new so they enter the funnel again
      await db.from('leads').update({ status: 'new', last_msg_at: now.toISOString() }).eq('id', lead.id);
      await sendWhatsApp({ phone: lead.phone, body: msg, templateName: 'reengage_7d' });
      results.reengaged_7d++;
    }

    // ---- Nudge check-in reminders (+24hr, +48hr) for active clients ----
    await nudgeCheckins(db, now);

    console.log(`Nudge cron: 2hr=${results.nudged_2hr}, dropped=${results.dropped_24hr}, reengaged=${results.reengaged_7d}`);
    return res.json({ success: true, ...results });

  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

async function nudgeCheckins(db, now) {
  const isSunday = now.getDay() === 0;
  const isMonday = now.getDay() === 1;
  const isTuesday = now.getDay() === 2;

  if (!isMonday && !isTuesday) return;

  const { data: clients } = await db
    .from('clients')
    .select('id, phone, name, program_started_at')
    .eq('status', 'active');

  for (const client of clients || []) {
    const started = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - started) / 86400000);
    const weekNo = Math.floor(daysSinceStart / 7) + 1;

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (existing && existing.length > 0) continue;

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const formUrl = `${SITE_BASE}/checkin?c=${client.id}&w=${weekNo}`;

    const dayLabel = isMonday ? '+24hr' : '+48hr';
    const msg = hinglish
      ? `Reminder! 📝 Week ${weekNo} ka check-in abhi tak pending hai. 2 min lagega bas: ${formUrl}`
      : `Reminder! 📝 Your Week ${weekNo} check-in is still pending. Takes just 2 min: ${formUrl}`;

    await sendWhatsApp({ phone: client.phone, body: msg, templateName: `checkin_nudge_${dayLabel}` });
  }
}
