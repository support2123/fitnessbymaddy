const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

const NUDGE_WINDOW_DAYS = 7;
const MAX_NUDGES = 1;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - NUDGE_WINDOW_DAYS * 86400000).toISOString();
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo)
      .lte('last_msg_at', oneDayAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ action: 'no_leads_to_nudge' });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_reengage');

      if ((count || 0) >= MAX_NUDGES) continue;

      await sendWhatsApp(lead.phone, 'nudge_reengage', [
        lead.name || 'there',
      ]);

      nudged++;
    }

    return res.json({ action: 'nudges_sent', nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
