const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isCron = req.headers['x-vercel-cron'] === '1';
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;

  if (!isCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of leads) {
      const allowed = await canSendToLead(lead.phone);
      if (!allowed) continue;

      const market = lead.market || 'GLOBAL';
      const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';

      if (isHinglish(market)) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          trialUrl
        ]);
      } else {
        await sendTemplate(lead.phone, 'nudge_trial_en', [
          lead.name || 'there',
          trialUrl
        ]);
      }

      sent++;
    }

    return res.status(200).json({
      success: true,
      leads_checked: leads.length,
      nudges_sent: sent
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
