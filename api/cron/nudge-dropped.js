const supabase = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglishMarket, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ status: 'no_leads_to_nudge' });
    }

    let nudged = 0;

    for (const lead of leads) {
      const { data: recentOut } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      const market = detectMarket(lead.phone);
      const template = isHinglishMarket(market) ? 'nudge_trial' : 'nudge_trial_en';

      await sendTemplate(lead.phone, template, [
        lead.name || 'there',
        '$20',
        'https://fitnessbymaddy.com/intake.html?lead=' + lead.id
      ], lead.name || '');

      nudged++;
    }

    return res.status(200).json({ status: 'done', nudged, total: leads ? leads.length : 0 });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
