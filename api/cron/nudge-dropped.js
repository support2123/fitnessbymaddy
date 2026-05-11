const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ success: true, nudged: 0 });
    }

    let nudged = 0;
    const errors = [];

    for (const lead of droppedLeads) {
      try {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_reengagement');

        if ((count || 0) >= 1) continue;

        const market = detectMarket(lead.phone);
        const isHinglish = market === 'IN';

        const msg = isHinglish
          ? `Hey ${lead.name || ''}! 👋 Maddy's team se ek quick message.\n\nHumara $20 Zoom trial abhi bhi available hai — 45 min session Maddy ke saath. No commitment.\n\nTry karna hai? Link: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nReply "STOP" agar messages nahi chahiye.`
          : `Hey ${lead.name || ''}! 👋 Quick note from Maddy's team.\n\nOur $20 Zoom trial is still available — a 45-min session with Maddy, no commitment.\n\nWant to try? Link: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nReply "STOP" to opt out.`;

        await sendWhatsApp({
          phone: lead.phone,
          body: msg,
          templateName: 'nudge_reengagement'
        });

        nudged++;
        await delay(500);
      } catch (err) {
        errors.push({ lead_id: lead.id, error: err.message });
      }
    }

    return res.json({ success: true, nudged, total: droppedLeads.length, errors });
  } catch (err) {
    console.error('Nudge dropped cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
