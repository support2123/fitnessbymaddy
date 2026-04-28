const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo)
      .lte('last_msg_at', twentyFourHoursAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ status: 'no_leads_to_nudge' });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_reengagement');

      if ((count || 0) >= 1) continue;

      const hinglish = isHinglish(lead.market);

      const body = hinglish
        ? `Hey! Maddy ki team se. Abhi bhi interested ho fitness journey start karne mein? Humare paas ek special $20 trial session hai — no commitment, sirf results.\n\nBook karo: https://www.fitnessbymaddy.com/intake?lead=${lead.id}`
        : `Hey! Maddy's team here. Still thinking about starting your fitness journey? We have a special $20 trial session — no commitment, just results.\n\nBook here: https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_reengagement',
        body
      });

      nudged++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await db
      .from('leads')
      .select('id, phone, market')
      .eq('status', 'new')
      .lte('last_msg_at', twoHoursAgo);

    let trialNudged = 0;

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { count } = await db
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if ((count || 0) >= 1) continue;

        const hinglish = isHinglish(lead.market);
        const body = hinglish
          ? `Hey! Abhi tak decide nahi kiya? Try karo Maddy ka $20 Zoom trial — sirf ek session mein feel hoga difference.\n\nhttps://www.fitnessbymaddy.com/intake?lead=${lead.id}`
          : `Hey! Haven't decided yet? Try Maddy's $20 Zoom trial — feel the difference in just one session.\n\nhttps://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body
        });

        trialNudged++;
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lte('last_msg_at', oneDayAgo);

    return res.status(200).json({
      status: 'completed',
      dropped_nudged: nudged,
      trial_nudged: trialNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
