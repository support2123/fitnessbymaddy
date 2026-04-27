const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { nudged: 0, skipped: 0 };

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ message: 'No leads to nudge', ...results });
    }

    const { data: recentNudges } = await db
      .from('messages')
      .select('phone')
      .eq('direction', 'out')
      .eq('template_name', 'reengagement_v1')
      .gte('sent_at', sevenDaysAgo);

    const recentlyNudgedPhones = new Set((recentNudges || []).map(m => m.phone));

    for (const lead of droppedLeads) {
      if (recentlyNudgedPhones.has(lead.phone)) {
        results.skipped++;
        continue;
      }

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? [lead.name || 'there', '20']
        : [lead.name || 'there', '20'];

      await sendWhatsApp(lead.phone, 'reengagement_v1', msg);
      results.nudged++;
    }

    return res.json({ message: 'Nudge complete', ...results });
  } catch (err) {
    console.error('[nudge-dropped]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
