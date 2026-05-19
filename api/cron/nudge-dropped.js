const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeadsNeedNudge } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of (newLeadsNeedNudge || [])) {
      const hoursSinceLastMsg = (now.getTime() - new Date(lead.last_msg_at).getTime()) / (60 * 60 * 1000);

      if (hoursSinceLastMsg >= 24) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
        console.log(`[nudge] Dropped ${maskPhone(lead.phone)} — 24h no reply`);
        continue;
      }

      if (hoursSinceLastMsg >= 2 && hoursSinceLastMsg < 24) {
        const { data: recentOut } = await db.from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (recentOut && recentOut.length > 0) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        nudged++;
      }
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;
    for (const lead of (reEngageLeads || [])) {
      const { data: recentOut } = await db.from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      const market = detectMarket(lead.phone);
      await sendTemplate(lead.phone, 'reengage_7day', [lead.name || 'there']);
      reEngaged++;
    }

    console.log(`[nudge-dropped] Nudged: ${nudged}, Dropped: ${dropped}, Re-engaged: ${reEngaged}`);
    return res.status(200).json({ ok: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('[nudge-dropped] Error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
