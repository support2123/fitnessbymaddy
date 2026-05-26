const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengagement')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentMsg && recentMsg.length > 0) continue;

      const hinglish = isHinglish(lead.market || detectMarket(lead.phone));

      const body = hinglish
        ? `Hey ${lead.name || 'there'}! Maddy ka $20 trial session abhi bhi available hai. Ek session try kar ke dekh — no commitment. Book here: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`
        : `Hey ${lead.name || 'there'}! Maddy's $20 trial session is still available. Try one session — no commitment needed. Book here: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengagement',
        body,
        params: [lead.name || 'there']
      });
      sent++;
    }

    return res.status(200).json({ success: true, nudged: sent });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
