const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Re-engage leads dropped 7-14 days ago (one attempt)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    let nudged = 0;
    for (const lead of (droppedLeads || [])) {
      const result = await sendTemplate(
        lead.phone,
        'win_back',
        [lead.name || 'there'],
        { force: true }
      );
      if (result.ok) nudged++;
    }

    // Nudge active clients with pending check-ins (+24h, +48h)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://fitnessbymaddy.com';

    for (const client of (activeClients || [])) {
      const started = new Date(client.program_started_at);
      const diffDays = Math.floor((now - started) / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(diffDays / 7) + 1;
      const dayInWeek = diffDays % 7;

      // Nudge on day 1 or 2 after check-in was due (Sunday = day 0)
      if (dayInWeek !== 1 && dayInWeek !== 2) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const formUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;
      await sendTemplate(client.phone, 'checkin_reminder', [
        client.name || 'there',
        String(weekNo),
        formUrl
      ]);
      clientNudges++;

      // 2 consecutive misses -> escalate
      if (dayInWeek === 2) {
        const { data: prevCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo - 1)
          .single();

        if (!prevCheckin) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            client.phone,
            `${client.name || 'Client'} — weeks ${weekNo - 1} and ${weekNo}`
          );
        }
      }
    }

    return res.status(200).json({ ok: true, nudged, clientNudges });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
