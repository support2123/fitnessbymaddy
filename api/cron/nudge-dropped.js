const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglishMarket, detectMarket, maskPhone } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'new')
      .gte('created_at', sevenDaysAgo.toISOString())
      .lte('last_msg_at', twoDaysAgo.toISOString());

    if (error) throw error;
    if (!leads || leads.length === 0) {
      return res.json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of leads) {
      const hinglish = isHinglishMarket(lead.market || detectMarket(lead.phone));
      const templateName = hinglish ? 'nudge_trial' : 'nudge_trial_en';
      const result = await sendTemplate(lead.phone, templateName, [lead.name || 'there']);

      if (result.ok) nudged++;
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo.toISOString());

    if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map(l => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', staleIds);
    }

    return res.json({
      ok: true,
      nudged,
      dropped: staleLeads?.length || 0
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
