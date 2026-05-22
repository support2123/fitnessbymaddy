const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

const REENGAGEMENT_WINDOW_DAYS = 7;
const NUDGE_COOLDOWN_DAYS = 3;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sb = getSupabase();
    const now = new Date();
    const windowStart = new Date(now.getTime() - REENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const { data: droppedLeads } = await sb
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'dropped')
      .gte('last_msg_at', windowStart.toISOString());

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ action: 'no_leads_to_nudge' });
    }

    const results = [];

    for (const lead of droppedLeads) {
      const lastMsg = new Date(lead.last_msg_at);
      const daysSinceLastMsg = (now.getTime() - lastMsg.getTime()) / (24 * 60 * 60 * 1000);

      if (daysSinceLastMsg < NUDGE_COOLDOWN_DAYS) continue;

      const canSend = await canSendToLead(lead.phone);
      if (!canSend) continue;

      const hinglish = isHinglish(lead.market || 'GLOBAL');
      const trialUrl = 'https://www.fitnessbymaddy.com/shred.html';

      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: hinglish
          ? [
              lead.name || 'there',
              'Abhi bhi soch rahe ho? Maddy ka $20 trial try karo — risk-free!',
              trialUrl,
            ]
          : [
              lead.name || 'there',
              'Still thinking? Try Maddy\'s $20 trial session — completely risk-free!',
              trialUrl,
            ],
      });

      results.push({ lead_id: lead.id, phone_masked: lead.phone.slice(0, 3) + '***' });
    }

    // Also nudge new leads with no reply after 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const { data: staleNewLeads } = await sb
      .from('leads')
      .select('id, phone, name, market, created_at, last_msg_at')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo.toISOString());

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { data: recentOutbound } = await sb
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (recentOutbound && recentOutbound.length > 0) continue;

        const canSend = await canSendToLead(lead.phone);
        if (!canSend) continue;

        const hinglish = isHinglish(lead.market || 'GLOBAL');
        await sendTemplate(lead.phone, 'nudge_trial', {
          name: lead.name || 'there',
          templateParams: hinglish
            ? [lead.name || 'there', 'Hey! Maddy ka $20 trial try karo, risk-free hai!', 'https://www.fitnessbymaddy.com/shred.html']
            : [lead.name || 'there', 'Hey! Try Maddy\'s $20 trial — completely risk-free!', 'https://www.fitnessbymaddy.com/shred.html'],
        });

        results.push({ lead_id: lead.id, type: 'stale_new_nudge' });
      }

      // Mark stale leads (24+ hours, no reply) as dropped
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      await sb
        .from('leads')
        .update({ status: 'dropped' })
        .eq('status', 'new')
        .lte('created_at', oneDayAgo.toISOString())
        .lte('last_msg_at', oneDayAgo.toISOString());
    }

    return res.status(200).json({ success: true, nudged: results.length });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
