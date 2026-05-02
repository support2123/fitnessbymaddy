const { supabase } = require('../_lib/supabase');
const { sendWhatsAppWithRateLimit } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Re-engage leads that were dropped 7-14 days ago (only nudge once)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengagement_7d')
        .limit(1);

      if (recentMsg && recentMsg.length > 0) continue;

      await sendWhatsAppWithRateLimit(
        lead.phone,
        'reengagement_7d',
        [lead.name || 'there'],
        lead.name || 'there',
        false
      );

      nudged++;
    }

    // Nudge active clients who haven't submitted check-in (24hr and 48hr)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;

    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const dayOfWeek = now.getDay(); // 0=Sun
      // Nudge on Monday (24hr after Sunday send) and Tuesday (48hr)
      if (dayOfWeek === 1 || dayOfWeek === 2) {
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendWhatsAppWithRateLimit(
          client.phone,
          'checkin_nudge',
          [client.name || 'there', String(weekNo), checkinUrl],
          client.name || 'there',
          true
        );
        checkinNudges++;
      }
    }

    return res.status(200).json({ ok: true, nudged, checkinNudges });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
