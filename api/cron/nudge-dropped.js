const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: recentMsg } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', twoHoursAgo)
          .limit(1);

        if (recentMsg && recentMsg.length > 0) continue;

        const market = lead.market || detectMarket(lead.phone);
        const template = isHinglish(market) ? 'nudge_trial' : 'nudge_trial_en';
        await sendTemplate(lead.phone, template, [lead.name || 'there']);
        nudged++;
      }
    }

    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo);

    let dropped = 0;
    if (deadLeads) {
      for (const lead of deadLeads) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const { data: qualifiedStale } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'qualified')
      .lt('last_msg_at', twoDaysAgo)
      .gt('created_at', sevenDaysAgo);

    let qualifiedNudged = 0;
    if (qualifiedStale) {
      for (const lead of qualifiedStale) {
        const { data: recentMsg } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', twoHoursAgo)
          .limit(1);

        if (recentMsg && recentMsg.length > 0) continue;

        const market = lead.market || detectMarket(lead.phone);
        const template = isHinglish(market) ? 'nudge_checkout' : 'nudge_checkout_en';
        await sendTemplate(lead.phone, template, [lead.name || 'there']);
        qualifiedNudged++;
      }
    }

    return res.status(200).json({
      ok: true, nudged, dropped, qualifiedNudged
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
