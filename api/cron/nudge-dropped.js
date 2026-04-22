const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gte('created_at', sevenDaysAgo)
      .lte('last_msg_at', oneDayAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ action: 'no_leads_to_nudge' });
    }

    const { data: recentMessages } = await db
      .from('messages')
      .select('phone')
      .eq('direction', 'out')
      .eq('template_name', 'reengagement_v1')
      .gte('sent_at', sevenDaysAgo);

    const alreadyNudgedPhones = new Set((recentMessages || []).map((m) => m.phone));

    let nudged = 0;

    for (const lead of droppedLeads) {
      if (alreadyNudgedPhones.has(lead.phone)) continue;

      try {
        await sendWhatsApp(lead.phone, 'reengagement_v1', [
          lead.name || 'there',
        ]);
        nudged++;
      } catch (e) {
        console.error(`[NUDGE] Error for ${maskPhone(lead.phone)}:`, e.message);
      }
    }

    console.log(`[NUDGE CRON] Nudged ${nudged} of ${droppedLeads.length} dropped leads`);
    return res.status(200).json({ success: true, nudged, total: droppedLeads.length });
  } catch (err) {
    console.error('[NUDGE CRON ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
