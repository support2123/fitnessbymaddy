const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);

  const authHeader = req.headers['authorization'] || '';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isVercel = req.headers['x-vercel-cron'] === '1';

  if (!isCron && !isVercel) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge' });
    }

    const results = [];

    for (const lead of leads) {
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_reengagement')
        .limit(1);

      if (recentMsg && recentMsg.length > 0) {
        results.push({ lead_id: lead.id, action: 'already_nudged' });
        continue;
      }

      const baseUrl = process.env.SITE_URL || 'https://fitnessbymaddy.com';
      const trialUrl = `${baseUrl}/shred.html`;

      const params = lead.market === 'IN'
        ? [lead.name || 'there', 'Abhi bhi sooch rahe ho? 🤔 Try our $20 trial — zero risk, full results. Book now:', trialUrl]
        : [lead.name || 'there', 'Still thinking it over? 🤔 Try our $20 trial — zero risk, full guidance. Book now:', trialUrl];

      await sendWhatsApp(lead.phone, 'nudge_reengagement', params);

      results.push({ lead_id: lead.id, action: 'nudged' });
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
