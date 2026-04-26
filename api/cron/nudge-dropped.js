// api/cron/nudge-dropped.js — Daily cron: nudge leads, check-in reminders, re-engagement

const { supabase } = require('../_lib/supabase');
const { sendTemplate, sendText } = require('../_lib/whatsapp');
const { notifyMaddy } = require('../_lib/escalation');
const { maskPhone } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  // Only accept GET (Vercel cron triggers via GET)
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Verify cron auth ──────────────────────────────────────────────
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[nudge-dropped] Unauthorized cron request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results = {
    leads_nudged: 0,
    leads_dropped: 0,
    checkins_nudged: 0,
    reengaged: 0,
  };

  try {
    console.log('[nudge-dropped] Starting daily nudge cron job');

    const now = new Date();

    // ════════════════════════════════════════════════════════════════
    // PART 1 — Lead nudges
    // ════════════════════════════════════════════════════════════════

    // 1a. Find leads where status='new' AND last_msg_at is 2-24 hours ago
    //     AND no outbound message sent in last 2 hours
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeableLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    if (nudgeableLeads && nudgeableLeads.length > 0) {
      for (const lead of nudgeableLeads) {
        const masked = maskPhone(lead.phone);

        try {
          // Check if we already sent an outbound message in the last 2 hours
          const { data: recentOut } = await supabase
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('direction', 'out')
            .gte('sent_at', twoHoursAgo)
            .limit(1);

          if (recentOut && recentOut.length > 0) {
            continue; // Already messaged recently
          }

          console.log(`[nudge-dropped] Nudging lead ${masked}`);

          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            'https://www.exlyapp.com/checkout/zoom-trial',
          ]);

          results.leads_nudged++;
        } catch (err) {
          console.error(`[nudge-dropped] Nudge failed for ${masked}:`, err.message);
        }
      }
    }

    // 1b. Find leads where status='new' AND created_at >24hrs ago AND last_msg_at >24hrs ago
    //     Mark those as 'dropped'
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo)
      .lte('last_msg_at', twentyFourHoursAgo);

    if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map((l) => l.id);

      const { error: updateErr } = await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', staleIds);

      if (!updateErr) {
        results.leads_dropped = staleLeads.length;
        console.log(`[nudge-dropped] Dropped ${staleLeads.length} stale leads`);
      } else {
        console.error('[nudge-dropped] Failed to drop stale leads:', updateErr.message);
      }
    }

    // ════════════════════════════════════════════════════════════════
    // PART 2 — Check-in nudges
    // ════════════════════════════════════════════════════════════════

    // Find scheduled nudge records that haven't been fully processed
    const { data: nudgeSchedules } = await supabase
      .from('messages')
      .select('*')
      .eq('template_name', 'checkin_nudge_schedule')
      .eq('status', 'scheduled');

    if (nudgeSchedules && nudgeSchedules.length > 0) {
      for (const schedule of nudgeSchedules) {
        try {
          const scheduleData = JSON.parse(schedule.body);
          const { client_id, week_no, form_sent_at } = scheduleData;

          if (!client_id || !week_no || !form_sent_at) continue;

          const formSentTime = new Date(form_sent_at);
          const hoursSinceSent = (now - formSentTime) / (1000 * 60 * 60);

          // Check if client already submitted their check-in
          const { data: existingCheckin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client_id)
            .eq('week_no', week_no)
            .limit(1);

          if (existingCheckin && existingCheckin.length > 0) {
            // Check-in done; mark schedule as complete
            await supabase
              .from('messages')
              .update({ status: 'completed' })
              .eq('id', schedule.id);
            continue;
          }

          // Fetch client info for messaging
          const { data: client } = await supabase
            .from('clients')
            .select('phone, name, id')
            .eq('id', client_id)
            .single();

          if (!client) continue;

          const masked = maskPhone(client.phone);
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client_id}&w=${week_no}`;

          if (hoursSinceSent >= 24 && hoursSinceSent < 48 && !scheduleData.nudge_24h) {
            // First nudge at 24 hours
            console.log(`[nudge-dropped] 24h check-in nudge for ${masked}, week ${week_no}`);

            await sendText(
              client.phone,
              `Hey ${client.name || 'there'}! Just a reminder to submit your Week ${week_no} check-in. ` +
              `It only takes 2 minutes and helps us keep your program on track:\n${checkinUrl}`
            );

            // Update schedule record
            scheduleData.nudge_24h = true;
            await supabase
              .from('messages')
              .update({ body: JSON.stringify(scheduleData) })
              .eq('id', schedule.id);

            results.checkins_nudged++;
          } else if (hoursSinceSent >= 48 && hoursSinceSent < 72 && !scheduleData.nudge_48h) {
            // Second nudge at 48 hours
            console.log(`[nudge-dropped] 48h check-in nudge for ${masked}, week ${week_no}`);

            await sendText(
              client.phone,
              `${client.name || 'Hey'}, we noticed your Week ${week_no} check-in is still pending. ` +
              `Your updated program is waiting on this! Please submit it here:\n${checkinUrl}`
            );

            scheduleData.nudge_48h = true;
            await supabase
              .from('messages')
              .update({ body: JSON.stringify(scheduleData) })
              .eq('id', schedule.id);

            results.checkins_nudged++;
          } else if (hoursSinceSent >= 72) {
            // 72+ hours — escalate to Maddy
            console.log(`[nudge-dropped] 72h+ missed check-in for ${masked}, week ${week_no} — escalating`);

            // Check for consecutive missed check-ins
            const previousWeek = week_no - 1;
            const { data: prevCheckin } = await supabase
              .from('checkins')
              .select('id')
              .eq('client_id', client_id)
              .eq('week_no', previousWeek)
              .limit(1);

            const consecutive = !prevCheckin || prevCheckin.length === 0;
            const escalationNote = consecutive
              ? `2+ consecutive missed check-ins (weeks ${previousWeek} and ${week_no})`
              : `Missed check-in for week ${week_no} (72+ hours)`;

            await notifyMaddy(
              `Missed check-in: ${escalationNote}`,
              {
                phone: client.phone,
                clientId: client_id,
                messageBody: escalationNote,
              }
            );

            // Mark schedule as completed (escalated)
            await supabase
              .from('messages')
              .update({ status: 'completed' })
              .eq('id', schedule.id);

            results.checkins_nudged++;
          }
        } catch (err) {
          console.error('[nudge-dropped] Check-in nudge error:', err.message);
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // PART 3 — Dropped lead re-engagement (7-day rule)
    // ════════════════════════════════════════════════════════════════

    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    // Target leads dropped exactly 7 days ago (within a 24-hour window)
    const sevenDaysAgoStart = new Date(sevenDaysAgo);
    sevenDaysAgoStart.setHours(0, 0, 0, 0);
    const sevenDaysAgoEnd = new Date(sevenDaysAgo);
    sevenDaysAgoEnd.setHours(23, 59, 59, 999);

    // Find leads that were last updated ~7 days ago with status='dropped'
    // We approximate by checking leads dropped whose last_msg_at is ~7 days old
    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgoStart.toISOString())
      .lte('last_msg_at', sevenDaysAgoEnd.toISOString());

    if (reengageLeads && reengageLeads.length > 0) {
      for (const lead of reengageLeads) {
        const masked = maskPhone(lead.phone);

        try {
          // Check if we already sent a re-engagement message
          const { data: existingReengage } = await supabase
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('template_name', 'reengage_offer')
            .limit(1);

          if (existingReengage && existingReengage.length > 0) {
            continue; // Already sent re-engagement
          }

          console.log(`[nudge-dropped] Re-engaging dropped lead ${masked}`);

          await sendTemplate(lead.phone, 'reengage_offer', [
            lead.name || 'there',
            'https://www.exlyapp.com/checkout/zoom-trial',
          ]);

          await sendText(
            lead.phone,
            `Hey ${lead.name || 'there'}! We wanted to reach out one last time. ` +
            `We have a special offer on our Zoom trial session — just $15 (usually $20). ` +
            `No commitment, just a 1-on-1 session with Coach Maddy. Interested? Reply "yes"!`
          );

          results.reengaged++;
        } catch (err) {
          console.error(`[nudge-dropped] Re-engage failed for ${masked}:`, err.message);
        }
      }
    }

    console.log(`[nudge-dropped] Done:`, results);

    return res.status(200).json(results);
  } catch (err) {
    console.error('[nudge-dropped] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
