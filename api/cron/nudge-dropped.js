const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { maskPhone, isHinglish, detectMarket } = require('../../lib/phone');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { re_engaged: 0, timed_out: 0, errors: 0 };

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Flow A step 3: Nudge leads with no reply after 2 hours
    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    if (newLeads) {
      for (const lead of newLeads) {
        try {
          // Check if we already nudged
          const { data: nudgeMsg } = await db
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('template_name', 'nudge_trial')
            .limit(1);

          if (nudgeMsg && nudgeMsg.length > 0) continue;

          const market = detectMarket(lead.phone);
          const hinglish = isHinglish(market);

          await sendWhatsApp({
            phone: lead.phone,
            templateName: 'nudge_trial',
            params: hinglish
              ? ['Abhi bhi soch rahe ho? 🤔 $20 ka trial try karo — risk-free!']
              : ['Still thinking? 🤔 Try our $20 trial — completely risk-free!']
          });

          results.re_engaged++;
        } catch (err) {
          console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
          results.errors++;
        }
      }
    }

    // Flow A step 4: Mark leads as dropped after 24 hours of no reply
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        // Check if they replied
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replies || replies.length === 0) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          results.timed_out++;
        }
      }
    }

    // Re-engage dropped leads (7-day rule)
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        try {
          // Only re-engage once
          const { data: reEngageMsg } = await db
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('template_name', 're_engage_7day')
            .limit(1);

          if (reEngageMsg && reEngageMsg.length > 0) continue;

          // Don't re-engage if they opted out
          const { data: optOutMsg } = await db
            .from('messages')
            .select('body')
            .eq('phone', lead.phone)
            .eq('direction', 'in')
            .order('sent_at', { ascending: false })
            .limit(1);

          if (optOutMsg && optOutMsg[0]) {
            const lower = optOutMsg[0].body.toLowerCase();
            if (['stop', 'unsubscribe', 'opt out'].some(kw => lower.includes(kw))) continue;
          }

          const market = detectMarket(lead.phone);
          const hinglish = isHinglish(market);

          await sendWhatsApp({
            phone: lead.phone,
            templateName: 're_engage_7day',
            params: hinglish
              ? ['Hey! Maddy ka naya batch start ho raha hai. Interested ho toh reply karo 💪']
              : ['Hey! Maddy\'s new batch is starting soon. Reply if you\'re interested 💪']
          });

          results.re_engaged++;
        } catch (err) {
          console.error(`Re-engage failed for ${maskPhone(lead.phone)}:`, err.message);
          results.errors++;
        }
      }
    }

    return res.json({ ok: true, ...results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
