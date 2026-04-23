const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}` &&
      !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  // Nudge leads that went silent 2 hours after welcome (status still 'new')
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const { data: silentLeads } = await db.from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoHoursAgo)
    .gt('last_msg_at', twentyFourHoursAgo);

  const results = { nudged: 0, dropped: 0, reengaged: 0 };

  if (silentLeads) {
    for (const lead of silentLeads) {
      const sentCount = await db.from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out');

      if ((sentCount.count || 0) >= 3) continue;

      const nudgeMsg = lead.market === 'IN'
        ? `Hey! \u{1F44B} Maddy ka $20 trial session try karo — ek Zoom call mein samajh aa jayega kya karna hai.\n\nhttps://www.fitnessbymaddy.com/intake.html?program=zoom_trial`
        : `Hey! \u{1F44B} Try Maddy's $20 trial session — one Zoom call to understand what you need.\n\nhttps://www.fitnessbymaddy.com/intake.html?program=zoom_trial`;

      await sendWhatsApp(lead.phone, nudgeMsg, 'nudge_trial');
      results.nudged++;
    }
  }

  // Drop leads that have been silent for 24+ hours
  const { data: staleLeads } = await db.from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twentyFourHoursAgo);

  if (staleLeads) {
    for (const lead of staleLeads) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      results.dropped++;
    }
  }

  // Re-engage dropped leads after 7 days (one-time attempt)
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reengageLeads } = await db.from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo)
    .gt('last_msg_at', eightDaysAgo);

  if (reengageLeads) {
    for (const lead of reengageLeads) {
      const reengageMsg = lead.market === 'IN'
        ? `Hey ${lead.name || ''}, abhi bhi fitness goals pe kaam karna chahte ho? Maddy ke programs mein limited spots hain. Reply karo toh help karte hain! \u{1F4AA}`
        : `Hey ${lead.name || ''}, still thinking about your fitness goals? Maddy's programs have limited spots. Reply and we'll help you get started! \u{1F4AA}`;

      const result = await sendWhatsApp(lead.phone, reengageMsg, 'reengage_7day');
      if (!result.skipped) results.reengaged++;
    }
  }

  return res.status(200).json({ success: true, results });
};
