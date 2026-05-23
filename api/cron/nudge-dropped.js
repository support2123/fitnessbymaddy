const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  const { data: leads } = await db.from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', sevenDaysAgo)
    .gt('created_at', fourteenDaysAgo);

  if (!leads || leads.length === 0) {
    return res.status(200).json({ message: 'No leads to nudge' });
  }

  let nudged = 0;

  for (const lead of leads) {
    const { data: recentMsg } = await db.from('messages')
      .select('sent_at')
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .eq('template_name', 'nudge_trial')
      .single();

    if (recentMsg) continue;

    const market = lead.market || 'IN';
    const template = market === 'IN' ? 'nudge_trial_hi' : 'nudge_trial_en';

    await sendWhatsApp(lead.phone, template, {
      name: lead.name || 'there',
      templateParams: [
        lead.name || 'there',
        'https://fitnessbymaddy.com/program-trial.html'
      ]
    });

    nudged++;
  }

  return res.status(200).json({ success: true, nudged });
};
