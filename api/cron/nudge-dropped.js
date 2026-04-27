const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

const NUDGE_WINDOW_DAYS = 7;
const MIN_AGE_HOURS = 24;

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - NUDGE_WINDOW_DAYS * 86400000).toISOString();
    const oneDayAgo = new Date(Date.now() - MIN_AGE_HOURS * 3600000).toISOString();

    // Find new leads who haven't replied in 2+ hours (nudge with trial)
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(Date.now() - 2 * 3600000).toISOString())
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;
    let dropped = 0;

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / 3600000;

        if (hoursSinceLastMsg >= 24) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
          continue;
        }

        const market = lead.market || detectMarket(lead.phone);
        const hinglish = isHinglish(market);
        const templateName = hinglish ? 'nudge_trial_hi' : 'nudge_trial_en';

        const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';
        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there',
          trialUrl,
        ]);

        nudged++;
      }
    }

    // Re-engage dropped leads within 7-day window (one-time)
    const { data: recentDropped } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo)
      .lt('created_at', oneDayAgo);

    let reengaged = 0;

    if (recentDropped) {
      for (const lead of recentDropped) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_dropped')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        const market = lead.market || detectMarket(lead.phone);
        const hinglish = isHinglish(market);
        const templateName = hinglish ? 'reengage_dropped_hi' : 'reengage_dropped_en';

        await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
        reengaged++;
      }
    }

    return res.json({ ok: true, nudged, dropped, reengaged });
  } catch (err) {
    console.error('[CRON-NUDGE ERROR]', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
