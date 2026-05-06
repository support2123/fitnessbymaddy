const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of leads) {
      const { data: recentNudge } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .gt('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentNudge && recentNudge.length > 0) continue;

      const result = await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there'], true);
      if (result.sent) {
        nudged++;
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      }
    }

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);
        const dayOfWeek = now.getDay();

        if (dayOfWeek !== 2 && dayOfWeek !== 3) continue;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const { data: nudgeSent } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .gt('sent_at', twoDaysAgo)
          .ilike('body', '%check-in%')
          .limit(1);

        if (nudgeSent && nudgeSent.length > 0) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'checkin_reminder', [client.name || 'there', String(weekNo), checkinUrl], true);
        checkinNudges++;
      }
    }

    return res.status(200).json({ ok: true, nudged, checkin_nudges: checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
