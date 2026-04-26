const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { canSendMessage, logMessage } = require('../_lib/rate-limit');
const { json, isHinglish } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twoDaysAgo);

    const nudgeResults = [];

    if (newLeadsToNudge) {
      for (const lead of newLeadsToNudge) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        if (!(await canSendMessage(lead.phone))) continue;

        const hinglish = isHinglish(lead.market);
        await sendWhatsApp(lead.phone, 'nudge_trial', [
          lead.name || 'there',
        ]);
        await logMessage(lead.phone, 'out',
          hinglish ? 'Trial session sirf $20 mein try karo' : 'Try a trial session for just $20',
          'nudge_trial'
        );
        nudgeResults.push({ phone: lead.phone, action: 'nudged' });
      }
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', twoDaysAgo);

    if (staleLeads) {
      const staleIds = staleLeads.map(l => l.id);
      if (staleIds.length > 0) {
        await supabase.from('leads')
          .update({ status: 'dropped' })
          .in('id', staleIds);
      }
    }

    const { data: droppedToReengage } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo);

    const reengageResults = [];
    if (droppedToReengage) {
      for (const lead of droppedToReengage) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (msgs && msgs.length > 0) continue;
        if (!(await canSendMessage(lead.phone))) continue;

        await sendWhatsApp(lead.phone, 'reengage_7day', [lead.name || 'there']);
        await logMessage(lead.phone, 'out', 'Re-engagement after 7 days', 'reengage_7day');
        reengageResults.push({ phone: lead.phone, action: 'reengaged' });
      }
    }

    return json(res, 200, {
      action: 'nudge_done',
      nudged: nudgeResults.length,
      dropped: staleLeads ? staleLeads.length : 0,
      reengaged: reengageResults.length,
    });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return json(res, 500, { error: 'Cron failed' });
  }
};
