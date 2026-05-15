const { supabase } = require('../lib/supabase');
const { sendTemplate, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    if (!nudgeLeads || nudgeLeads.length === 0) {
      return res.json({ ok: true, nudged: 0, dropped: 0 });
    }

    let nudged = 0;
    let dropped = 0;

    for (const lead of nudgeLeads) {
      const hoursSinceContact = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

      if (hoursSinceContact > 24 * 7) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
        continue;
      }

      const market = lead.market || detectMarket(lead.phone);
      const isHinglish = market === 'IN';

      await sendTemplate(lead.phone, isHinglish ? 'nudge_trial_hi' : 'nudge_trial_en', {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]
      });
      nudged++;
    }

    const expiredCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lte('last_msg_at', expiredCutoff)
      .lte('created_at', sevenDaysAgo)
      .select('id', { count: 'exact', head: true });

    return res.json({ ok: true, nudged, dropped: dropped + (count || 0) });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
