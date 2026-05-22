const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const results = [];

    // 1. Nudge new leads with no reply after 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    for (const lead of (staleNewLeads || [])) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      const hasReplied = replies && replies.length > 0;

      if (!hasReplied) {
        const { data: nudges } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (!nudges || nudges.length === 0) {
          await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
          results.push({ phone: lead.phone, action: 'nudge_sent' });
        }
      }
    }

    // 2. Drop leads with no reply after 24 hours
    const { data: oldLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    for (const lead of (oldLeads || [])) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (!replies || replies.length === 0) {
        await db.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        results.push({ phone: lead.phone, action: 'dropped' });
      }
    }

    // 3. Nudge active clients with missing check-ins (+24h, +48h)
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (checkin && checkin.length > 0) continue;

      const sundayOffset = now.getDay();
      const hoursSinceSunday = sundayOffset * 24 + now.getHours();

      if (hoursSinceSunday >= 24 && hoursSinceSunday < 48) {
        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          String(currentWeek)
        ]);
        results.push({ client_id: client.id, action: 'checkin_nudge_24h' });
      } else if (hoursSinceSunday >= 48 && hoursSinceSunday < 72) {
        await sendTemplate(client.phone, 'checkin_reminder_final', [
          client.name || 'there',
          String(currentWeek)
        ]);
        results.push({ client_id: client.id, action: 'checkin_nudge_48h' });
      }

      // 2 consecutive missed check-ins → escalate
      if (currentWeek >= 2) {
        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .gte('week_no', currentWeek - 1)
          .lte('week_no', currentWeek);

        if (!recentCheckins || recentCheckins.length === 0) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name}, Phone: ${client.phone}, Weeks ${currentWeek - 1} & ${currentWeek}`
          );
          results.push({ client_id: client.id, action: 'escalated_missed_checkins' });
        }
      }
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
