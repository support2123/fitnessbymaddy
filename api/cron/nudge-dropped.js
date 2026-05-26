const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglishMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const now = new Date();

    // Nudge leads who haven't replied after 2 hours (new leads only)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of staleNewLeads || []) {
      const { data: msgs } = await db
        .from('messages')
        .select('id, template_name')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial');

      if (msgs && msgs.length > 0) continue;

      const hinglish = isHinglishMarket(lead.market);
      const trialUrl = 'https://fitnessbymaddy.com/shred.html';

      const nudgeMsg = hinglish
        ? `Hey! Maddy ki team se ek baar phir.\n\nAgar confused ho toh $20 trial se start karo — ek Zoom session mein Maddy khud guide karegi.\n\nTry karo: ${trialUrl}`
        : `Hey! Just following up from Maddy's team.\n\nIf you're unsure, start with a $20 trial — one Zoom session where Maddy guides you personally.\n\nTry it: ${trialUrl}`;

      await sendWhatsApp(lead.phone, nudgeMsg, 'nudge_trial');
      nudged++;
    }

    // Drop leads with no reply after 24 hours
    const { data: deadLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    for (const lead of deadLeads || []) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    // Re-engage dropped leads after 7 days (one-time)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reengaged = 0;

    for (const lead of reengageLeads || []) {
      const { data: msgs } = await db
        .from('messages')
        .select('id, template_name')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_7day');

      if (msgs && msgs.length > 0) continue;

      const hinglish = isHinglishMarket(lead.market);

      const reengageMsg = hinglish
        ? `Hey! Maddy ke programs mein abhi bhi interest hai? Hum limited-time offer de rahe hain — reply karo "YES" agar start karna hai.`
        : `Hey! Still interested in Maddy's programs? We have a limited-time offer running — reply "YES" if you'd like to get started.`;

      await sendWhatsApp(lead.phone, reengageMsg, 'reengage_7day');
      reengaged++;
    }

    return res.status(200).json({
      message: 'Nudge cron completed',
      nudged,
      dropped,
      reengaged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
