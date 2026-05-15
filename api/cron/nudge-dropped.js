const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: droppedLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('created_at', fourteenDaysAgo)
    .lte('last_msg_at', sevenDaysAgo);

  if (!droppedLeads || droppedLeads.length === 0) {
    return res.status(200).json({ action: 'no_leads_to_nudge' });
  }

  const results = [];

  for (const lead of droppedLeads) {
    const { data: recentOut } = await db
      .from('messages')
      .select('sent_at')
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .gte('sent_at', sevenDaysAgo)
      .limit(1);

    if (recentOut && recentOut.length > 0) {
      results.push({ phone: lead.phone, action: 'skipped_recent_message' });
      continue;
    }

    const market = lead.market || 'GLOBAL';
    const params = market === 'IN'
      ? ['Just ₹1,660 mein trial le sakte ho — full 1-hour Zoom session with a custom plan.']
      : ['Try a $20 trial — full 1-hour Zoom session with a custom plan.'];

    await sendTemplate(lead.phone, 'nudge_trial', params);
    results.push({ phone: lead.phone, action: 'nudged' });
  }

  return res.status(200).json({ action: 'nudge_complete', count: results.length, results });
};
