const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // FLOW A step 3: Nudge leads with no reply after 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const { data: unrepliedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo.toISOString());

    let nudged = 0;

    if (unrepliedLeads) {
      for (const lead of unrepliedLeads) {
        const { data: replies } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (replies && replies.length > 0) continue;

        const { data: nudges } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (nudges && nudges.length > 0) continue;

        const nudgeMsg = isHinglish(lead.market)
          ? "Hey! Maddy ka $20 Zoom trial try karo — full session, koi commitment nahi. Book karo: https://www.fitnessbymaddy.com/shred.html"
          : "Hey! Try Maddy's $20 Zoom trial — full session, no commitment. Book here: https://www.fitnessbymaddy.com/shred.html";

        await sendWhatsApp(lead.phone, nudgeMsg, 'nudge_trial');
        nudged++;
      }
    }

    // FLOW A step 4: Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo.toISOString());

    let dropped = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: replies } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (replies && replies.length > 0) continue;

        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads after 7 days (one-time)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', eightDaysAgo.toISOString())
      .lt('last_msg_at', sevenDaysAgo.toISOString());

    let reengaged = 0;

    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const { data: reengageMsg } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (reengageMsg && reengageMsg.length > 0) continue;

        const msg = isHinglish(lead.market)
          ? "Hey! Abhi bhi fitness goals mein interested ho? Maddy ke programs abhi available hain. Reply karo, let's chat!"
          : "Hey! Still interested in reaching your fitness goals? Maddy's programs are available now. Reply and let's chat!";

        await sendWhatsApp(lead.phone, msg, 'reengage_7day');
        reengaged++;
      }
    }

    return res.status(200).json({ nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
