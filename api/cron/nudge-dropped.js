const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'new')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.json({ action: 'no_leads_to_nudge' });
    }

    let nudged = 0;
    let skipped = 0;

    for (const lead of leads) {
      const canSend = await canSendMessage(lead.phone);
      if (!canSend) {
        skipped++;
        continue;
      }

      const market = lead.market || detectMarket(lead.phone);
      const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial';

      await sendTemplate(lead.phone, templateName, [
        lead.name || 'there',
        'https://fitnessbymaddy.com/program-trial.html',
      ]);

      nudged++;
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', fourteenDaysAgo);

    if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map(l => l.id);
      await supabase.from('leads')
        .update({ status: 'dropped' })
        .in('id', staleIds);
    }

    return res.json({
      success: true,
      nudged,
      skipped,
      auto_dropped: staleLeads?.length || 0,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
