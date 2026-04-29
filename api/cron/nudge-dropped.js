const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    let nudgesSent = 0;

    // 1) Process scheduled check-in nudges that are due
    const now = new Date();
    const { data: pendingNudges } = await db
      .from('messages')
      .select('*')
      .eq('template_name', 'nudge_checkin_pending')
      .eq('status', 'scheduled')
      .lte('sent_at', now.toISOString());

    if (pendingNudges) {
      for (const nudge of pendingNudges) {
        const meta = JSON.parse(nudge.body);

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', meta.client_id)
          .eq('week_no', meta.week_no)
          .single();

        if (existing) {
          await db.from('messages').update({ status: 'cancelled' }).eq('id', nudge.id);
          continue;
        }

        const params = meta.hinglish
          ? ['Reminder: apna weekly check-in abhi fill karo! ' + meta.checkin_url]
          : ['Reminder: Please complete your weekly check-in! ' + meta.checkin_url];

        await sendWhatsApp(nudge.phone, 'nudge_checkin', params);
        await db.from('messages').update({ status: 'sent' }).eq('id', nudge.id);
        nudgesSent++;
      }
    }

    // 2) Re-engage dropped leads (7-day rule: nudge once if dropped 7+ days ago, not yet nudged)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: alreadyNudged } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_dropped')
          .limit(1);

        if (alreadyNudged && alreadyNudged.length > 0) continue;

        const hinglish = isHinglish(lead.market);
        const params = hinglish
          ? [lead.name || 'there', 'Abhi bhi interested ho? Maddy ka $20 trial try karo - bilkul risk free!']
          : [lead.name || 'there', 'Still interested? Try Maddy\'s $20 trial session - completely risk free!'];

        await sendWhatsApp(lead.phone, 'reengage_dropped', params);
        nudgesSent++;
      }
    }

    // 3) Send 2hr nudge for new leads with no reply
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .gte('created_at', fourHoursAgo)
      .lte('created_at', twoHoursAgo);

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { data: hasReply } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (hasReply && hasReply.length > 0) continue;

        const hinglish = isHinglish(lead.market);
        const trialUrl = 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial';
        const params = hinglish
          ? [`Ek $20 trial session se start karo - risk free! ${trialUrl}`]
          : [`Start with a $20 trial session - completely risk free! ${trialUrl}`];

        await sendWhatsApp(lead.phone, 'nudge_trial', params);
        nudgesSent++;
      }
    }

    // 4) Mark 24hr-old new leads as dropped
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    await db
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lte('created_at', oneDayAgo);

    return res.status(200).json({ message: 'Nudge cron complete', nudges_sent: nudgesSent });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
