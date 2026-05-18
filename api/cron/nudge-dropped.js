const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglishMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.json({ nudged: 0 });
    }

    let nudged = 0;

    for (const lead of leads) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_reengagement')
        .limit(1);

      if (recentMsg && recentMsg.length > 0) continue;

      const hinglish = isHinglishMarket(lead.market);
      const templateName = hinglish ? 'nudge_reengagement_hi' : 'nudge_reengagement_en';

      await sendWhatsApp(lead.phone, templateName, [
        lead.name || 'there',
        'https://fitnessbymaddy.com/intake.html',
      ]);

      nudged++;
    }

    return res.json({ success: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'cron failed' });
  }
};
