const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Also handle 2-hour nudge for new leads with no reply
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Nudge new leads that haven't replied in 2+ hours
    const { data: staleLeads } = await supabase()
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudgedCount = 0;
    let droppedCount = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        // Check if we already sent a nudge
        const { data: nudgesSent } = await supabase()
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (!nudgesSent || nudgesSent.length === 0) {
          const canSend = await canSendMessage(lead.phone, false);
          if (canSend) {
            await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
            nudgedCount++;
          }
        }
      }
    }

    // Drop leads that haven't replied in 24+ hours
    const { data: deadLeads } = await supabase()
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    if (deadLeads) {
      for (const lead of deadLeads) {
        // Check if they ever replied after their first message
        const { data: replies } = await supabase()
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gte('sent_at', lead.created_at)
          .limit(2);

        // If only 1 inbound message (the initial one), drop
        if (!replies || replies.length <= 1) {
          await supabase()
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          droppedCount++;
        }
      }
    }

    // Re-engage dropped leads (7-day rule)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await supabase()
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    let reengaged = 0;

    if (reengageLeads) {
      for (const lead of reengageLeads) {
        // Only re-engage once
        const { data: reengageSent } = await supabase()
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (!reengageSent || reengageSent.length === 0) {
          const market = detectMarket(lead.phone);
          const canSend = await canSendMessage(lead.phone, false);
          if (canSend) {
            await sendTemplate(lead.phone, 'reengage_7day', [lead.name || 'there']);
            reengaged++;
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      nudged: nudgedCount,
      dropped: droppedCount,
      reengaged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
