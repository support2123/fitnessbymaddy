const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

const REENGAGEMENT_WINDOW_DAYS = 7;

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const cutoff = new Date(Date.now() - REENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', cutoff.toISOString());

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ action: 'no_leads_to_nudge' });
    }

    const results = [];

    for (const lead of droppedLeads) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('template_name')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .like('template_name', 'reengagement%');

      if (msgs && msgs.length > 0) {
        results.push({ lead_id: lead.id, action: 'already_nudged' });
        continue;
      }

      const templateName = isHinglish(lead.market)
        ? 'reengagement_v1_hi'
        : 'reengagement_v1';

      await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
      results.push({ lead_id: lead.id, action: 'nudged' });
    }

    return res.json({ action: 'completed', count: results.length, results });
  } catch (err) {
    console.error('Nudge dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
