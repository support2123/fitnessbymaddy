const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ nudged: 0, message: 'No leads to re-engage' });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const allowed = await canSendToLead(lead.phone);
      if (!allowed) continue;

      const { data: optedOut } = await supabase
        .from('messages')
        .select('body')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .ilike('body', '%stop%')
        .limit(1);

      if (optedOut && optedOut.length > 0) continue;

      try {
        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        nudged++;
      } catch (e) {
        console.error(`Failed to nudge ${maskPhone(lead.phone)}:`, e.message);
      }
    }

    return res.json({ nudged, total_dropped: droppedLeads.length });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
