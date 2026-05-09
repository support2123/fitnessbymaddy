const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const cronSecret = req.headers.authorization;
  if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
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

    if (!droppedLeads?.length) {
      return res.status(200).json({ action: 'no_leads_to_nudge' });
    }

    const results = [];

    for (const lead of droppedLeads) {
      const { data: recentOutbound } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo)
        .limit(1)
        .single();

      if (recentOutbound) {
        results.push({ phone: maskPhone(lead.phone), action: 'skipped_recent_msg' });
        continue;
      }

      const market = lead.market || 'IN';
      const templateName = market === 'IN' ? 'reengagement_hi' : 'reengagement_en';

      await sendWhatsApp(lead.phone, templateName, [
        lead.name || 'there'
      ]);

      results.push({ phone: maskPhone(lead.phone), action: 'nudge_sent' });
    }

    return res.status(200).json({ action: 'nudge_complete', results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
