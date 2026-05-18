const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengagement_7day');

      if ((count || 0) > 0) continue;

      const market = detectMarket(lead.phone);
      const trialUrl = 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom_trial';

      const msgParams = isHinglish(market)
        ? [`Hey! Maddy ka $20 Zoom trial abhi available hai. Ek session try kar ke dekh: ${trialUrl}`]
        : [`Hey! Maddy's $20 Zoom trial is still available. Try one session and see: ${trialUrl}`];

      const result = await sendWhatsApp(lead.phone, 'reengagement_7day', msgParams);
      if (result.ok) sent++;
    }

    return res.json({ success: true, sent, total: droppedLeads.length });
  } catch (err) {
    console.error('[cron/nudge-dropped]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
