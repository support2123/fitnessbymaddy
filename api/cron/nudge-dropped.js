const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Re-engage leads that went silent 2-24 hours ago (Flow A step 3)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: silentLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;

    if (silentLeads) {
      for (const lead of silentLeads) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (count > 0) continue;

        const hinglish = isHinglish(lead.market);
        if (hinglish) {
          await sendTemplate(lead.phone, 'nudge_trial', [
            'Ek baar try karke dekho — sirf $20 mein Maddy ke saath LIVE Zoom session! 🔥\n👉 https://fitnessbymaddy.com/trial'
          ]);
        } else {
          await sendTemplate(lead.phone, 'nudge_trial', [
            'Give it a try — just $20 for a LIVE Zoom session with Maddy! 🔥\n👉 https://fitnessbymaddy.com/trial'
          ]);
        }
        nudged++;
      }
    }

    // Drop leads that have been silent for 24+ hours
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    if (staleLeads && staleLeads.length > 0) {
      const ids = staleLeads.map(l => l.id);
      await supabase.from('leads').update({ status: 'dropped' }).in('id', ids);
      dropped = ids.length;
    }

    // 7-day re-engagement for dropped leads
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 're_engage_7d');

        if (count > 0) continue;

        const hinglish = isHinglish(lead.market);
        if (hinglish) {
          await sendTemplate(lead.phone, 're_engage_7d', [
            'Hey! Abhi bhi interested ho fitness mein? Maddy ke saath ek free strategy call book karo 💪'
          ]);
        } else {
          await sendTemplate(lead.phone, 're_engage_7d', [
            'Hey! Still interested in getting fit? Book a free strategy call with Maddy 💪'
          ]);
        }
        reEngaged++;
      }
    }

    return res.json({ ok: true, nudged, dropped, reEngaged });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
