const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}` && authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;
    for (const lead of droppedLeads) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'reengagement_v1');

      if ((count || 0) > 0) continue;

      await sendWhatsApp(lead.phone, 'reengagement_v1', [
        lead.name || 'there',
      ]);
      sent++;
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let nudged = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const weekNo = calculateWeekNo(client.program_started_at);
        const { data: checkin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const { data: lastNudge } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('template_name', 'checkin_nudge')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (lastNudge) {
          const hoursSinceNudge = (Date.now() - new Date(lastNudge.sent_at).getTime()) / (1000 * 60 * 60);
          if (hoursSinceNudge < 24) continue;
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendWhatsApp(client.phone, 'checkin_nudge', [
          client.name || 'there',
          String(weekNo),
          checkinUrl,
        ]);
        nudged++;
      }
    }

    return res.status(200).json({ reengaged: sent, nudged, total: (droppedLeads?.length || 0) });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7)) + 1;
}
