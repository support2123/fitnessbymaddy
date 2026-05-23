const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!req.headers['x-vercel-cron'] && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', count: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const allowed = await canSendMessage(lead.phone);
      if (!allowed) continue;

      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact' })
        .eq('phone', lead.phone)
        .eq('template_name', 'reengagement_7day');

      if (count && count > 0) continue;

      await sendTemplate(lead.phone, 'reengagement_7day');
      nudged++;
    }

    return res.status(200).json({
      success: true,
      leads_checked: droppedLeads.length,
      nudged
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
