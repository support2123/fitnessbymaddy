const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let nudged = 0;
    let dropped = 0;

    // Nudge leads who haven't replied in 2 hours (but less than 24hrs)
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo.toISOString())
      .gt('last_msg_at', twentyFourHoursAgo.toISOString());

    if (staleLeads) {
      for (const lead of staleLeads) {
        const canSend = await canSendMessage(lead.phone, false);
        if (canSend) {
          const template = isHinglish(lead.market) ? 'nudge_trial_hi' : 'nudge_trial_en';
          await sendTemplate(lead.phone, template, [
            'https://fitnessbymaddy.com/program-trial.html'
          ]);
          nudged++;
        }
      }
    }

    // Drop leads who haven't replied in 24 hours
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo.toISOString());

    if (deadLeads && deadLeads.length > 0) {
      const ids = deadLeads.map(l => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', ids);
      dropped = deadLeads.length;
    }

    // Re-engage dropped leads (7-day rule) — only those dropped 7+ days ago
    // with a single soft re-engagement attempt
    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo.toISOString())
      .gt('last_msg_at', new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString());

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const canSend = await canSendMessage(lead.phone, false);
        if (canSend) {
          const template = isHinglish(lead.market) ? 'reengage_7day_hi' : 'reengage_7day_en';
          await sendTemplate(lead.phone, template);
          reengaged++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      nudged,
      dropped,
      reengaged
    });

  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
