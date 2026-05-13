const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { nudged_2hr: 0, nudged_trial: 0, dropped: 0, re_engaged: 0, errors: 0 };
    const now = new Date();

    // 1. Nudge leads with status='new' who haven't replied in 2 hours
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gte('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    for (const lead of (staleNewLeads || [])) {
      try {
        const hinglish = isHinglish(lead.market);
        const nudgeMsg = hinglish
          ? `Hey! Maddy ka $20 trial session try karo — ek Zoom call mein dekhlo coaching kaisa hota hai!\n\nBook karo: https://fitnessbymaddyy.exlyapp.com/checkout/trial`
          : `Hey! Try Maddy's $20 trial Zoom session — experience the coaching first-hand before committing!\n\nBook here: https://fitnessbymaddyy.exlyapp.com/checkout/trial`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body: nudgeMsg,
          params: [lead.name || 'there']
        });
        results.nudged_trial++;
      } catch (err) {
        results.errors++;
      }
    }

    // 2. Mark leads as dropped if no reply in 24 hours
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: expiredLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    if (expiredLeads && expiredLeads.length > 0) {
      const ids = expiredLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', ids);
      results.dropped = ids.length;
    }

    // 3. Re-engage dropped leads (7-day rule: only those dropped 7+ days ago, max once)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', eightDaysAgo);

    for (const lead of (reEngageLeads || [])) {
      try {
        // Check we haven't already sent a re-engage message
        const { data: recent } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (recent && recent.length > 0) continue;

        const hinglish = isHinglish(lead.market);
        const msg = hinglish
          ? `Hey! Abhi bhi fitness goals achieve karna chahte ho? Maddy ka $20 trial abhi bhi available hai — sirf ek session se difference dikhega!\n\nBook: https://fitnessbymaddyy.exlyapp.com/checkout/trial`
          : `Hey! Still thinking about your fitness goals? Maddy's $20 trial session is still available — one session can make all the difference!\n\nBook: https://fitnessbymaddyy.exlyapp.com/checkout/trial`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_7day',
          body: msg,
          params: [lead.name || 'there']
        });
        results.re_engaged++;
      } catch (err) {
        results.errors++;
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
