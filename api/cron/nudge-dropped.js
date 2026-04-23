const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ nudged: 0, message: 'No eligible dropped leads' });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      try {
        const { data: recentOut } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo)
          .limit(1);

        if (recentOut && recentOut.length > 0) continue;

        const market = lead.market || 'GLOBAL';
        const template = isHinglish(market) ? 'reengagement_7day' : 'reengagement_7day_en';

        await sendTemplate(lead.phone, template, [lead.name || 'there']);
        nudged++;
      } catch (e) {
        console.error('Nudge error for lead:', e.message);
      }
    }

    return res.json({ nudged, total_eligible: droppedLeads.length });

  } catch (err) {
    console.error('Nudge dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
