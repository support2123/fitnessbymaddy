const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { verifyCron, isHinglish, detectMarket } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  if (!verifyCron(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ ok: true, nudged: 0 });
    }

    const { data: recentlyMessaged } = await db
      .from('messages')
      .select('phone')
      .eq('direction', 'out')
      .gte('sent_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    const recentPhones = new Set(recentlyMessaged ? recentlyMessaged.map(m => m.phone) : []);
    let nudged = 0;

    for (const lead of droppedLeads) {
      if (recentPhones.has(lead.phone)) continue;

      const market = lead.market || detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || (hinglish ? 'Friend' : 'there'),
      ]);

      await db.from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);

      nudged++;
    }

    return res.json({ ok: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
