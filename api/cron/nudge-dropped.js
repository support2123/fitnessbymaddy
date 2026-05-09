const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // 2-hour nudge: leads who sent first message 2+ hours ago, still status=new, no outbound after welcome
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: recentMessages } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (recentMessages && recentMessages.length > 0) continue;

        const { data: nudgesSent } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (nudgesSent && nudgesSent.length > 0) continue;

        const market = detectMarket(lead.phone);
        const templateName = market === 'IN' ? 'nudge_trial_hi' : 'nudge_trial_en';
        await sendWhatsApp(lead.phone, templateName, [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html',
        ]);
        nudged++;
      }
    }

    // 24-hour drop: leads still status=new after 24 hours with no reply
    const { data: expiredLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo)
      .gt('created_at', sevenDaysAgo);

    if (expiredLeads) {
      for (const lead of expiredLeads) {
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (replies && replies.length > 0) continue;

        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage: leads dropped 7+ days ago (max once)
    let reengaged = 0;
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo);

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: reengageSent } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (reengageSent && reengageSent.length > 0) continue;

        const market = detectMarket(lead.phone);
        const templateName = market === 'IN' ? 'reengage_7day_hi' : 'reengage_7day_en';
        await sendWhatsApp(lead.phone, templateName, [lead.name || 'there']);
        reengaged++;
      }
    }

    return res.status(200).json({
      message: 'Nudge cron complete',
      nudged,
      dropped,
      reengaged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
