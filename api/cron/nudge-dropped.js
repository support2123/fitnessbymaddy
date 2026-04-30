const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

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
      return res.status(200).json({ action: 'no_leads_to_nudge' });
    }

    const results = [];

    for (const lead of droppedLeads) {
      const allowed = await canSendMessage(lead.phone);
      if (!allowed) {
        results.push({ lead_id: lead.id, action: 'rate_limited' });
        continue;
      }

      const market = lead.market || detectMarket(lead.phone);

      if (isHinglish(market)) {
        await sendTemplate(lead.phone, 'nudge_trial_hi', [
          lead.name || 'there',
          'https://www.fitnessbymaddy.com/shred.html',
        ]);
      } else {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://www.fitnessbymaddy.com/shred.html',
        ]);
      }

      results.push({ lead_id: lead.id, action: 'nudged' });
    }

    return res.status(200).json({ action: 'completed', count: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
