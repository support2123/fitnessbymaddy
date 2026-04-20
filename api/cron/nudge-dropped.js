const supabase = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (error) throw error;
    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { data: recentOut } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      nudged++;
    }

    // Also nudge clients who haven't submitted check-in (24hr and 48hr reminders)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: pendingClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (pendingClients) {
      for (const client of pendingClients) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const isSundayOrMonday = now.getDay() === 0 || now.getDay() === 1;
        if (!isSundayOrMonday) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          checkinUrl
        ]);
        checkinNudges++;
      }
    }

    return res.status(200).json({ ok: true, nudged, checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
