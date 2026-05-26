const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglishMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeableLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!nudgeableLeads || nudgeableLeads.length === 0) {
      return res.status(200).json({ action: 'no_nudgeable_leads' });
    }

    let sent = 0;

    for (const lead of nudgeableLeads) {
      const hinglish = isHinglishMarket(lead.market);

      const msg = hinglish
        ? `Hey ${lead.name || 'there'}! Maddy's team se — abhi bhi interested ho fitness mein?\n\nHamara $20 trial Zoom session try karo, risk-free: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nReply "STOP" to opt out.`
        : `Hey ${lead.name || 'there'}! Still thinking about your fitness journey?\n\nTry our $20 trial Zoom session — completely risk-free: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nReply "STOP" to opt out.`;

      const result = await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        body: msg
      });

      if (result.sent) sent++;
    }

    return res.status(200).json({ success: true, nudged: sent, total: nudgeableLeads.length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
