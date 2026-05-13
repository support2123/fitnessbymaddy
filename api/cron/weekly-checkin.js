const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  // Get all active clients
  const { data: clients, error } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (error || !clients) {
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  let sent = 0;
  let nudged = 0;

  for (const client of clients) {
    // Calculate current week number
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    // Check if program has ended
    if (client.program_ends_at && now > new Date(client.program_ends_at)) continue;

    // Check if checkin already exists for this week
    const { data: existing } = await db
      .from('checkins')
      .select('id, form_submitted_at, nudge_count, sent_at')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .single();

    if (existing && existing.form_submitted_at) continue; // already submitted

    if (!existing) {
      // Send new check-in form
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      await db.from('checkins').insert({
        client_id: client.id,
        week_no: currentWeek,
        sent_at: now.toISOString()
      });
      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(currentWeek),
        checkinUrl
      ]);
      sent++;
    } else {
      // Nudge if not submitted: +24hrs (nudge 1), +48hrs (nudge 2)
      const sentAt = new Date(existing.sent_at);
      const hoursSinceSent = (now - sentAt) / (1000 * 60 * 60);
      const nc = existing.nudge_count || 0;

      if (nc === 0 && hoursSinceSent >= 24) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
        await sendTemplate(client.phone, 'checkin_nudge', [
          client.name || 'there',
          checkinUrl
        ]);
        await db.from('checkins').update({ nudge_count: 1 }).eq('id', existing.id);
        nudged++;
      } else if (nc === 1 && hoursSinceSent >= 48) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
        await sendTemplate(client.phone, 'checkin_nudge_final', [
          client.name || 'there',
          checkinUrl
        ]);
        await db.from('checkins').update({ nudge_count: 2 }).eq('id', existing.id);
        nudged++;
      }

      // 2 consecutive missed check-ins → escalate
      if (nc >= 2) {
        const { data: prevCheckin } = await db
          .from('checkins')
          .select('form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek - 1)
          .single();

        if (prevCheckin && !prevCheckin.form_submitted_at) {
          const { notifyMaddy } = require('../../lib/whatsapp');
          const { maskPhone } = require('../../lib/escalation');
          await db.from('escalations').insert({
            phone: client.phone,
            client_id: client.id,
            reason: '2 consecutive missed check-ins'
          });
          await notifyMaddy(
            '2 missed check-ins',
            `Client: ${maskPhone(client.phone)}\nWeeks ${currentWeek - 1} and ${currentWeek} both missed.`
          );
        }
      }
    }
  }

  return res.status(200).json({ sent, nudged, total_clients: clients.length });
};
