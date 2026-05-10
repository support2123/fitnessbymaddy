const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  const now = new Date();

  // FLOW A Step 3: Nudge leads with no reply after 2 hours (status=new)
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: staleNewLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  let nudged = 0;
  let dropped = 0;

  if (staleNewLeads) {
    for (const lead of staleNewLeads) {
      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (replies && replies.length > 0) continue;

      const { count: nudgeCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial');

      if (!nudgeCount || nudgeCount === 0) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://www.fitnessbymaddy.com/program-trial.html',
        ], { supabase });
        nudged++;
      }
    }
  }

  // FLOW A Step 4: Drop leads after 24 hours with no reply
  const { data: expiredLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo);

  if (expiredLeads) {
    for (const lead of expiredLeads) {
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

  // Re-engage dropped leads (7-day rule): leads dropped 7+ days ago, re-engage once
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reEngageLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo)
    .gt('last_msg_at', fourteenDaysAgo);

  let reengaged = 0;

  if (reEngageLeads) {
    for (const lead of reEngageLeads) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day');

      if (count && count > 0) continue;

      await sendTemplate(lead.phone, 'reengage_7day', [
        lead.name || 'there',
      ], { supabase });
      reengaged++;
    }
  }

  return res.status(200).json({ ok: true, nudged, dropped, reengaged });
};
