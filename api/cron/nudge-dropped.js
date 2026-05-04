const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendToLead } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ action: 'no_leads_to_nudge' });
    }

    const results = { nudged: 0, skipped: 0 };

    for (const lead of droppedLeads) {
      const canSend = await canSendToLead(lead.phone);
      if (!canSend) {
        results.skipped++;
        continue;
      }

      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_reengagement');

      if (count && count > 0) {
        results.skipped++;
        continue;
      }

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      await sendTemplate(lead.phone, hinglish ? 'nudge_reengagement_hi' : 'nudge_reengagement', [
        lead.name || 'there',
      ]);

      results.nudged++;
    }

    return res.json({ success: true, ...results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
