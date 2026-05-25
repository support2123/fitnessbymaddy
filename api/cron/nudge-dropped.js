const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

/**
 * Masks a phone number for safe logging.
 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, -4).replace(/.(?=.{4})/g, '*').slice(0, -4) + phone.slice(-4);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    /* ── Verify cron secret ── */
    const authHeader = req.headers['authorization'] || '';
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || !authHeader.includes(cronSecret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabase = getSupabase();
    const now = new Date();

    /* ── Timestamps for the different windows ── */
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    let nudgedCount = 0;
    let droppedCount = 0;

    /* ──────────────────────────────────────────────
       1. Re-engage dropped leads (7-14 day window)
       Send re-engagement template max once.
    ────────────────────────────────────────────── */
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('id, phone, name, reengagement_sent')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    for (const lead of droppedLeads || []) {
      if (lead.reengagement_sent) continue; // max once

      try {
        await sendWhatsApp(lead.phone, 'reengage_v1', {
          name: lead.name || '',
        });

        await supabase
          .from('leads')
          .update({ reengagement_sent: true, updated_at: now.toISOString() })
          .eq('id', lead.id);

        nudgedCount++;
      } catch (err) {
        console.error(
          `nudge-dropped: reengage failed [${maskPhone(lead.phone)}]:`,
          err.message
        );
      }
    }

    /* ──────────────────────────────────────────────
       2. Nudge new leads (replied > 2hrs but < 24hrs ago)
    ────────────────────────────────────────────── */
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    for (const lead of staleNewLeads || []) {
      try {
        await sendWhatsApp(lead.phone, 'nudge_v1', {
          name: lead.name || '',
        });
        nudgedCount++;
      } catch (err) {
        console.error(
          `nudge-dropped: nudge failed [${maskPhone(lead.phone)}]:`,
          err.message
        );
      }
    }

    /* ──────────────────────────────────────────────
       3. Mark new leads as dropped (last reply > 24hrs)
    ────────────────────────────────────────────── */
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    for (const lead of expiredLeads || []) {
      try {
        await supabase
          .from('leads')
          .update({ status: 'dropped', updated_at: now.toISOString() })
          .eq('id', lead.id);

        droppedCount++;
      } catch (err) {
        console.error(
          `nudge-dropped: drop failed [${maskPhone(lead.phone)}]:`,
          err.message
        );
      }
    }

    return res.status(200).json({ nudged: nudgedCount, dropped: droppedCount });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
