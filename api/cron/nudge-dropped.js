const supabase = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const counts = {
      nudged_leads: 0,
      dropped_leads: 0,
      reengaged: 0,
      checkin_reminders: 0,
      checkin_urgent: 0,
    };

    // --- 1. Nudge stale new leads ---
    // Leads where status='new', last_msg_at > 2h ago but < 24h ago
    const { data: staleLeads, error: staleErr } = await supabase
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    if (staleErr) {
      console.error('Error fetching stale leads:', staleErr.message);
    }

    for (const lead of staleLeads || []) {
      // Check no outbound message sent in last 2 hours
      const { data: recentOutbound } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('created_at', twoHoursAgo)
        .limit(1);

      if (recentOutbound && recentOutbound.length > 0) continue;

      const trialLink = 'https://fitnessbymaddy.com/intake?plan=trial';
      const { success } = await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        trialLink,
      ]);
      if (success) counts.nudged_leads++;
    }

    // --- 2. Drop dead leads ---
    // Leads where status='new' AND last_msg_at > 24h ago
    const { data: deadLeads, error: deadErr } = await supabase
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (deadErr) {
      console.error('Error fetching dead leads:', deadErr.message);
    }

    if (deadLeads && deadLeads.length > 0) {
      const deadIds = deadLeads.map((l) => l.id);
      const { error: dropErr } = await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', deadIds);

      if (dropErr) {
        console.error('Error dropping leads:', dropErr.message);
      } else {
        counts.dropped_leads = deadIds.length;
        console.log(`Dropped ${deadIds.length} dead lead(s)`);
      }
    }

    // --- 3. Re-engage dropped leads (7-day rule) ---
    // Leads dropped between 7 and 8 days ago (so we only message once)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads, error: reengageErr } = await supabase
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'dropped')
      .gte('created_at', eightDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (reengageErr) {
      console.error('Error fetching re-engage leads:', reengageErr.message);
    }

    for (const lead of reengageLeads || []) {
      const { success } = await sendTemplate(lead.phone, 'reengage_7day', [
        lead.name || 'there',
      ]);
      if (success) counts.reengaged++;
    }

    // --- 4. Nudge missing check-ins ---
    const { data: activeClients, error: clientsErr } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (clientsErr) {
      console.error('Error fetching active clients:', clientsErr.message);
    }

    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

    for (const client of activeClients || []) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const diffMs = now.getTime() - startDate.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(diffDays / 7) + 1;

      if (weekNo < 1) continue;

      // Check if checkin exists for this week
      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existingCheckin) continue; // Already checked in

      // Find the weekly_checkin message for this client this week
      const { data: checkinMessages } = await supabase
        .from('messages')
        .select('id, created_at')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .or('template_name.eq.weekly_checkin,template_name.eq.weekly_checkin_hi')
        .order('created_at', { ascending: false })
        .limit(1);

      if (!checkinMessages || checkinMessages.length === 0) continue;

      const checkinSentAt = checkinMessages[0].created_at;

      // Check if 48h nudge is needed (sent more than 48h ago)
      if (checkinSentAt < fortyEightHoursAgo) {
        // Check we haven't already sent the urgent nudge
        const { data: urgentSent } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .eq('template_name', 'checkin_urgent')
          .gte('created_at', checkinSentAt)
          .limit(1);

        if (!urgentSent || urgentSent.length === 0) {
          const { success } = await sendTemplate(client.phone, 'checkin_urgent', [
            client.name,
            String(weekNo),
          ]);
          if (success) counts.checkin_urgent++;
        }
      }
      // Check if 24h nudge is needed (sent more than 24h ago)
      else if (checkinSentAt < twentyFourHoursAgo) {
        // Check we haven't already sent the reminder nudge
        const { data: reminderSent } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .eq('template_name', 'checkin_reminder')
          .gte('created_at', checkinSentAt)
          .limit(1);

        if (!reminderSent || reminderSent.length === 0) {
          const { success } = await sendTemplate(client.phone, 'checkin_reminder', [
            client.name,
            String(weekNo),
          ]);
          if (success) counts.checkin_reminders++;
        }
      }
    }

    return res.status(200).json(counts);
  } catch (err) {
    console.error('nudge-dropped cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
