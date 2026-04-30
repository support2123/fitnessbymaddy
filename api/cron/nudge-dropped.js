const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of leads) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_reactivate');

      if ((count || 0) > 0) continue;

      const hinglish = isHinglish(lead.market);

      await sendTemplate(lead.phone, 'nudge_reactivate', [
        lead.name || (hinglish ? 'Hey' : 'Hi there'),
        hinglish
          ? 'Abhi bhi interested ho fitness journey mein? $20 trial se start karo — koi commitment nahi!'
          : "Still interested in your fitness journey? Start with a $20 trial — no commitment!",
        'https://fitnessbymaddy.com/intake.html',
      ]);

      nudged++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: recentLeads } = await supabase
      .from('leads')
      .select('id, phone, market, name')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let trialNudges = 0;
    if (recentLeads) {
      for (const lead of recentLeads) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if ((count || 0) > 0) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'Hey',
          'https://fitnessbymaddy.com/intake.html',
        ]);
        trialNudges++;
      }
    }

    return res.status(200).json({ message: 'Nudges sent', nudged, trialNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
