const supabase = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    if (error) {
      console.error('Failed to fetch dropped leads:', error.message);
      return res.status(500).json({ error: 'DB error' });
    }

    let nudged = 0;

    for (const lead of leads || []) {
      const market = detectMarket(lead.phone);

      const { data: msgs } = await supabase
        .from('messages')
        .select('template_name')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_reengage')
        .limit(1);

      if (msgs && msgs.length > 0) continue;

      const template = market === 'IN' ? 'nudge_reengage_hindi' : 'nudge_reengage';
      const trialLink = 'https://www.fitnessbymaddy.com/shred.html';

      const result = await sendTemplate(lead.phone, template, [
        lead.name || 'there',
        trialLink
      ]);

      if (result.success) nudged++;
    }

    const { data: noReplyLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .gt('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());

    let trialNudged = 0;

    for (const lead of noReplyLeads || []) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('template_name')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (msgs && msgs.length > 0) continue;

      const market = detectMarket(lead.phone);
      const template = market === 'IN' ? 'nudge_trial_hindi' : 'nudge_trial';
      const trialUrl = 'https://www.fitnessbymaddy.com/shred.html';

      const result = await sendTemplate(lead.phone, template, [
        lead.name || 'there',
        trialUrl
      ]);

      if (result.success) trialNudged++;
    }

    return res.status(200).json({
      success: true,
      reengaged: nudged,
      trial_nudged: trialNudged,
      total_checked: (leads || []).length
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
