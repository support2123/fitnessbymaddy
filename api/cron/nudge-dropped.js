const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 2 * SEVEN_DAYS_MS).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads?.length) {
      return res.status(200).json({ message: 'No leads to nudge' });
    }

    const { data: sentMessages } = await db
      .from('messages')
      .select('phone')
      .eq('template_name', 'nudge_reengagement')
      .gte('sent_at', fourteenDaysAgo);

    const alreadyNudged = new Set(sentMessages?.map(m => m.phone) || []);

    let nudged = 0;

    for (const lead of droppedLeads) {
      if (alreadyNudged.has(lead.phone)) continue;

      const hinglish = isHinglish(lead.market);

      await sendWhatsApp({
        phone: lead.phone,
        templateName: hinglish ? 'nudge_reengagement_hi' : 'nudge_reengagement_en',
        bodyValues: [lead.name || 'there'],
      });

      nudged++;
    }

    return res.status(200).json({ message: 'Nudge cron complete', nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
