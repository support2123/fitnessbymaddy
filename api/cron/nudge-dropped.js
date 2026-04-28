const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // FLOW A step 3: Nudge leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of staleNewLeads || []) {
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (msgs && msgs.length > 0) continue;

      const { data: nudgeSent } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .ilike('body', '%trial%')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (nudgeSent && nudgeSent.length > 0) continue;

      const isIN = lead.market === 'IN';
      const msg = isIN
        ? `Hey! 👋 Sirf $20 mein ek live Zoom trial le lo Maddy ke saath — no commitment.\n\n👉 https://fitnessbymaddy.com/shred.html\n\nTry karo, phir decide karo!`
        : `Hey! 👋 Try a live Zoom trial with Maddy for just $20 — no commitment.\n\n👉 https://fitnessbymaddy.com/shred.html\n\nTry it out, then decide!`;

      await sendWhatsApp({ phone: lead.phone, body: msg });
      nudged++;
    }

    // Mark leads as dropped if no reply after 24 hours
    const { data: expiredLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    for (const lead of expiredLeads || []) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (replies && replies.length > 0) continue;

      await db.from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
      dropped++;
    }

    // Re-engage dropped leads (7-day rule): leads dropped 7 days ago, one final attempt
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('created_at', sevenDaysAgo)
      .gt('created_at', eightDaysAgo);

    let reengaged = 0;

    for (const lead of reengageLeads || []) {
      const { data: recentOut } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gt('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      const isIN = lead.market === 'IN';
      const msg = isIN
        ? `Hi! Maddy's team se ek last message 🙏\n\nAgar abhi bhi fitness goal pe kaam karna hai toh hum ready hain help karne ko. Koi bhi program ya trial — bas reply karo.\n\nNo pressure. Jab ready ho, hum hain.`
        : `Hi! One last message from Maddy's team 🙏\n\nIf you're still working towards your fitness goals, we're here to help. Any program or trial — just reply.\n\nNo pressure. We're here when you're ready.`;

      await sendWhatsApp({ phone: lead.phone, body: msg });
      reengaged++;
    }

    // Nudge active clients who haven't submitted their check-in
    const { data: pendingCheckins } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .not('program_started_at', 'is', null);

    let clientNudged = 0;

    for (const client of pendingCheckins || []) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const dayOfWeek = now.getUTCDay();
      const daysSinceSunday = dayOfWeek;

      if (daysSinceSunday !== 1 && daysSinceSunday !== 2) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const nudgeMsg = daysSinceSunday === 1
        ? `Reminder: Your Week ${weekNo} check-in is still pending! 📝\n\n👉 ${checkinUrl}\n\nQuick 5-min form — helps us keep your plan on track.`
        : `Last call for Week ${weekNo} check-in! ⏰\n\n👉 ${checkinUrl}\n\nDon't skip — your next week's plan depends on it.`;

      await sendWhatsApp({ phone: client.phone, body: nudgeMsg });
      clientNudged++;
    }

    return res.status(200).json({
      ok: true, nudged, dropped, reengaged, clientNudged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
