const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const db = getSupabase();

  try {
    const now = new Date();

    // --- Nudge new leads who haven't replied in 2 hours ---
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    for (const lead of staleNewLeads || []) {
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial');

      if (msgs?.length) continue;

      const msg = isHinglish(lead.market)
        ? "Hey! Humara $20 trial session try karo - ek Zoom call mein Maddy ke saath workout. Risk-free start!\n\nhttps://fitnessbymaddy.com/program-trial.html"
        : "Hey! Try our $20 trial session - a live Zoom workout with Maddy. Risk-free way to start!\n\nhttps://fitnessbymaddy.com/program-trial.html";

      await sendWhatsApp(lead.phone, msg, 'nudge_trial');
      nudged++;
    }

    // --- Drop leads with no reply after 24 hours ---
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: deadLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;
    for (const lead of deadLeads || []) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at);

      if (!replies?.length) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // --- Re-engage dropped leads after 7 days (one-time) ---
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', eightDaysAgo)
      .lt('last_msg_at', sevenDaysAgo);

    let reengaged = 0;
    for (const lead of reengageLeads || []) {
      const { data: alreadySent } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day');

      if (alreadySent?.length) continue;

      const msg = isHinglish(lead.market)
        ? "Hi! Maddy ki team se ek aur baar. Abhi bhi apne fitness goals ke baare mein soch rahe ho? Hum yahan hai help ke liye! Reply karo aur shuru karo."
        : "Hi! Just checking in from Maddy's team. Still thinking about your fitness goals? We're here to help! Reply to get started.";

      await sendWhatsApp(lead.phone, msg, 'reengage_7day');
      reengaged++;
    }

    // --- Nudge active clients who haven't submitted check-in after 24h / 48h ---
    const { data: pendingCheckins } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    for (const client of pendingCheckins || []) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const dayOfWeek = now.getUTCDay();
      const isMondayOrTuesday = dayOfWeek === 1 || dayOfWeek === 2;
      if (!isMondayOrTuesday) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const templateName = dayOfWeek === 1 ? 'checkin_nudge_24h' : 'checkin_nudge_48h';

      const { data: alreadyNudged } = await db
        .from('messages')
        .select('id')
        .eq('phone', client.phone)
        .eq('template_name', templateName)
        .gt('sent_at', new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString());

      if (alreadyNudged?.length) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const msg = `Reminder: Week ${weekNo} check-in pending! Fill it out so we can keep your progress on track:\n${checkinUrl}`;

      await sendWhatsApp(client.phone, msg, templateName);
      checkinNudges++;
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      reengaged,
      checkinNudges,
    });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
