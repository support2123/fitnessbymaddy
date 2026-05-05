const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { nudged: 0, skipped: 0 };

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', sevenDaysAgo)
      .gte('created_at', fourteenDaysAgo);

    if (!newLeads || newLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', results });
    }

    for (const lead of newLeads) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .limit(1)
        .single();

      if (recentMsg) {
        results.skipped++;
        continue;
      }

      const market = lead.market || 'IN';
      const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';

      const msgBody = market === 'IN'
        ? [`Hey! Maddy ka $20 trial session try karo - no commitment, pure results: ${trialUrl}`]
        : [`Hey! Try Maddy's $20 trial session - no commitment, pure results: ${trialUrl}`];

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        bodyValues: msgBody,
      });

      results.nudged++;
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
