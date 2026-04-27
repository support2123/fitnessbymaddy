const { getSupabase } = require('../../lib/supabase');
const { canSendToLead, sendText } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sb = getSupabase();

    // Re-engage leads that were dropped 7+ days ago but less than 14 days
    // Only nudge once after the 7-day cool-off
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await sb
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      // Check rate limit
      const allowed = await canSendToLead(lead.phone);
      if (!allowed) continue;

      // Check if we already sent a re-engagement (look for nudge in messages)
      const { data: prevNudges } = await sb
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .ilike('body', '%one more chance%')
        .limit(1);

      if (prevNudges && prevNudges.length > 0) continue;

      const market = detectMarket(lead.phone);
      const trialUrl = 'https://www.fitnessbymaddy.com/shred.html';

      if (isHinglish(market)) {
        await sendText(lead.phone,
          `Hey! 👋 Maddy's team se ek last message.\n\n` +
          `Agar abhi bhi fitness goal pe serious ho, toh ek baar try karo — ` +
          `humaare programs real results dete hain.\n\n` +
          `Checkout karo: ${trialUrl}\n\n` +
          `One more chance — we'd love to help! 💪`
        );
      } else {
        await sendText(lead.phone,
          `Hey! 👋 One last message from Maddy's team.\n\n` +
          `If you're still serious about your fitness goals, we'd love to help.\n\n` +
          `Check out our programs: ${trialUrl}\n\n` +
          `One more chance — real results, real coaching. 💪`
        );
      }

      nudged++;
    }

    // Also handle nudging new leads who haven't replied
    // 2hr nudge for trial
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

    const { data: silentLeads } = await sb
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', fourHoursAgo);

    let trialNudged = 0;

    if (silentLeads) {
      for (const lead of silentLeads) {
        const allowed = await canSendToLead(lead.phone);
        if (!allowed) continue;

        // Only nudge if they haven't been messaged since the welcome
        const { count } = await sb
          .from('messages')
          .select('id', { count: 'exact' })
          .eq('phone', lead.phone)
          .eq('direction', 'out');

        if (count > 1) continue;

        const market = detectMarket(lead.phone);
        if (isHinglish(market)) {
          await sendText(lead.phone,
            `Hey! Abhi tak decide nahi hua? 🤔\n\n` +
            `Ek $20 Zoom trial se shuru karo — dekhlo Maddy ka coaching kaisa hai.\n\n` +
            `Book karo: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`
          );
        } else {
          await sendText(lead.phone,
            `Hey! Still thinking? 🤔\n\n` +
            `Start with a $20 Zoom trial — see what Maddy's coaching is like.\n\n` +
            `Book here: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`
          );
        }

        trialNudged++;
      }
    }

    // Mark 24hr+ unresponsive leads as dropped
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await sb
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    return res.json({ nudged, trial_nudged: trialNudged });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
