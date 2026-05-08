const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ action: 'no_leads_to_nudge' });
    }

    const results = [];

    for (const lead of droppedLeads) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengagement_v1');

      if ((count || 0) > 0) {
        results.push({ lead_id: lead.id, action: 'already_nudged' });
        continue;
      }

      await sendTemplate(lead.phone, 'reengagement_v1', [
        lead.name || 'there',
      ]);

      results.push({ lead_id: lead.id, action: 'nudged' });
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600000).toISOString();

    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if ((count || 0) > 0) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
        ]);

        results.push({ lead_id: lead.id, action: 'trial_nudge' });
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 3600000).toISOString();
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', oneDayAgo);

    if (expiredLeads && expiredLeads.length > 0) {
      const ids = expiredLeads.map((l) => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', ids);

      results.push({ action: 'expired_to_dropped', count: ids.length });
    }

    return res.json({ success: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
