const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ ok: true, message: 'No leads to nudge' });
    }

    let nudged = 0;

    for (const lead of leads) {
      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const templateName = hinglish ? 'nudge_trial_hi' : 'nudge_trial_en';
      const result = await sendTemplate(lead.phone, templateName, [
        lead.name || 'there'
      ]);

      if (result.ok) nudged++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNew } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', fourteenDaysAgo);

    if (staleNew && staleNew.length > 0) {
      const ids = staleNew.map(l => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', ids);
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped: staleNew?.length || 0
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
