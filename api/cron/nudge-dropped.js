const { supabase } = require('../_lib/supabase');
const { sendTemplate, canSendMessage } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    for (const lead of newLeads || []) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
      dropped++;
    }

    const { data: qualifiedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'qualified')
      .lte('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    for (const lead of qualifiedLeads || []) {
      const daysSinceCreated = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreated > 7) continue;

      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const market = detectMarket(lead.phone);

      if (isHinglish(market)) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
        ]);
      } else {
        await sendTemplate(lead.phone, 'nudge_trial_en', [
          lead.name || 'there',
          'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
        ]);
      }
      nudged++;
    }

    const { data: recentDropped } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo);

    let reEngaged = 0;
    for (const lead of recentDropped || []) {
      const daysSinceDropped = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceDropped < 3 || daysSinceDropped > 7) continue;

      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const market = detectMarket(lead.phone);
      if (isHinglish(market)) {
        await sendTemplate(lead.phone, 'win_back_hi', [
          lead.name || 'there',
        ]);
      } else {
        await sendTemplate(lead.phone, 'win_back_en', [
          lead.name || 'there',
        ]);
      }
      reEngaged++;
    }

    return res.status(200).json({ dropped, nudged, reEngaged });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'cron failed' });
  }
};
