const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads?.length) {
      return res.status(200).json({ message: 'No leads to nudge' });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengagement_v1')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentMsg?.length) continue;

      const market = detectMarket(lead.phone);
      const template = isHinglish(market) ? 'reengagement_v1_hi' : 'reengagement_v1_en';

      await sendWhatsApp(lead.phone, template, [
        lead.name || 'there',
      ]);

      nudged++;
    }

    return res.status(200).json({ nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
