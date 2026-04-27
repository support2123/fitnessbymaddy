const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeable } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    const nudged = [];
    if (nudgeable) {
      for (const lead of nudgeable) {
        const { data: recentOut } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gt('sent_at', twoHoursAgo)
          .limit(1);

        if (recentOut && recentOut.length > 0) continue;

        const msg = isHinglish(lead.market)
          ? "Abhi bhi soch rahe ho? Ek $20 trial session se start karo — pehle try karo, phir decide karo!\n\nhttps://fitnessbymaddy.com/program-trial.html"
          : "Still thinking? Start with a $20 trial session — try it first, decide later!\n\nhttps://fitnessbymaddy.com/program-trial.html";

        await sendWhatsApp(lead.phone, msg, 'nudge_trial');
        nudged.push(lead.id);
      }
    }

    const { data: stale } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (stale && stale.length > 0) {
      const ids = stale.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', ids);
    }

    const { data: reEngageable } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    const reEngaged = [];
    if (reEngageable) {
      for (const lead of reEngageable) {
        const { data: recentOut } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 're_engage')
          .limit(1);

        if (recentOut && recentOut.length > 0) continue;

        const msg = isHinglish(lead.market)
          ? "Hey! Maddy ke programs abhi available hain. Kya goal hai? Reply karo, hum help karte hain."
          : "Hey! Maddy's programs are still available. What's your goal? Reply and we'll help you find the right fit.";

        await sendWhatsApp(lead.phone, msg, 're_engage');
        reEngaged.push(lead.id);
      }
    }

    return res.status(200).json({
      nudged: nudged.length,
      dropped: stale?.length || 0,
      re_engaged: reEngaged.length
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
