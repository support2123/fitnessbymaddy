const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('id, phone, name, created_at')
      .eq('status', 'new')
      .lte('created_at', sevenDaysAgo)
      .gte('created_at', fourteenDaysAgo);

    if (!newLeads || newLeads.length === 0) {
      return res.json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of newLeads) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentMsg && recentMsg.length > 0) continue;

      await sendTemplate(
        lead.phone,
        'nudge_trial',
        [lead.name || 'there'],
        lead.name || 'there'
      );

      nudged++;
    }

    return res.json({ ok: true, nudged });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
