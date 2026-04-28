const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    // Find leads that went silent:
    // 1. new leads with no reply after 2 hours → nudge_trial
    // 2. new leads with no reply after 24 hours → mark dropped
    // 3. dropped leads from 7 days ago → one re-engagement attempt

    const now = new Date();

    // 2-hour nudge: new leads created > 2hrs ago, not yet nudged
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: freshLeads } = await db
      .from('leads')
      .select('id, phone, name, created_at, last_msg_at')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);

    let nudged = 0;
    let dropped = 0;
    let reengaged = 0;

    if (freshLeads) {
      for (const lead of freshLeads) {
        const hasReplied = lead.last_msg_at &&
          new Date(lead.last_msg_at).getTime() > new Date(lead.created_at).getTime() + 60000;

        if (hasReplied) continue;

        const age = now.getTime() - new Date(lead.created_at).getTime();

        if (age > 24 * 60 * 60 * 1000) {
          // Over 24 hours with no reply → drop
          await db.from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
        } else {
          // Between 2-24 hours → nudge
          await sendTemplate(lead.phone, 'nudge_trial', {
            name: lead.name || 'there',
            templateParams: [lead.name || 'there', '$20']
          });
          nudged++;
        }
      }
    }

    // 7-day re-engagement: leads dropped exactly 7 days ago
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 86400000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('id, phone, name, program_interest')
      .eq('status', 'dropped')
      .gt('created_at', eightDaysAgo)
      .lt('created_at', sevenDaysAgo);

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        // Check we haven't already sent a re-engagement
        const { data: recentMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .single();

        if (recentMsg) continue;

        await sendTemplate(lead.phone, 'reengage_7day', {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        });
        reengaged++;
      }
    }

    return res.status(200).json({
      action: 'nudge_complete',
      nudged,
      dropped,
      reengaged
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
