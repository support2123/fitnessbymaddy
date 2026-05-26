const supabase = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find leads that went silent (new status, no message in 2+ hours, < 24 hours old)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Nudge leads who haven't replied in 2 hours
    const { data: silentLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, created_at')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of (silentLeads || [])) {
      const ageHours = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60);

      if (ageHours >= 24) {
        // 24+ hours: mark as dropped
        await supabase.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
        console.log(`Dropped: ${maskPhone(lead.phone)} (24hr no reply)`);
        continue;
      }

      // 2-24 hours: send nudge with trial link
      const result = await sendTemplate(
        lead.phone,
        'nudge_trial',
        [lead.name || 'there', 'https://fitnessbymaddy.com/shred.html'],
        lead.name
      );

      if (result.ok) nudged++;
      console.log(`Nudge → ${maskPhone(lead.phone)}: ${result.ok ? 'sent' : result.error}`);
    }

    // Re-engagement: leads dropped 7+ days ago, never converted
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    let reengaged = 0;
    for (const lead of (droppedLeads || [])) {
      // Only re-engage once — check if we already sent a re-engagement message
      const { data: recentOut } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_v1')
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      const result = await sendTemplate(
        lead.phone,
        'reengage_v1',
        [lead.name || 'there'],
        lead.name
      );

      if (result.ok) reengaged++;
    }

    console.log(`Nudge cron: ${nudged} nudged, ${dropped} dropped, ${reengaged} re-engaged`);
    return res.status(200).json({ ok: true, nudged, dropped, reengaged });

  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
