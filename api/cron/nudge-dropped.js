const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');

const REENGAGEMENT_WINDOW_DAYS = 7;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - REENGAGEMENT_WINDOW_DAYS);

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, last_msg_at')
      .eq('status', 'dropped')
      .gte('last_msg_at', cutoffDate.toISOString())
      .order('last_msg_at', { ascending: false });

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to re-engage', sent: 0 });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengagement_v1')
        .limit(1);

      if (recentMsg && recentMsg.length > 0) continue;

      const market = lead.market || detectMarket(lead.phone);
      const trialLink = 'https://fitnessbymaddyy.exlyapp.com/checkout/trial';

      if (isHinglish(market)) {
        await sendTemplate(lead.phone, 'reengagement_v1', [
          lead.name || 'there',
          'Abhi bhi interested ho? Maddy ka $20 trial session try karo — zero risk, full value.',
          trialLink,
        ]);
      } else {
        await sendTemplate(lead.phone, 'reengagement_v1', [
          lead.name || 'there',
          "Still interested? Try Maddy's $20 trial session — zero risk, full value.",
          trialLink,
        ]);
      }

      sent++;
    }

    return res.status(200).json({ message: 'Re-engagement nudges sent', sent });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
