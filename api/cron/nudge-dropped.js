// GET /api/cron/nudge-dropped
// Vercel Cron — runs daily at 05:00 UTC (schedule: "0 5 * * *").
// Handles two classes of nudges:
//   1. Lead nudges: 2-hour follow-up and 24-hour drop for cold leads.
//   2. Check-in nudges: First and final nudge for clients who haven't
//      submitted their weekly check-in; creates escalation after 2 missed weeks.

const { supabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { createEscalation } = require('../lib/escalation');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a Date offset by `hours` hours before now. */
function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/** Returns a Date offset by `days` days before now. */
function daysAgo(days) {
  return hoursAgo(days * 24);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify Vercel cron secret
  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    console.warn('nudge-dropped cron: unauthorized request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const summary = {
    lead_nudges_sent: 0,
    leads_dropped: 0,
    checkin_first_nudges: 0,
    checkin_final_nudges: 0,
    checkin_escalations: 0,
    errors: []
  };

  try {
    // =========================================================================
    // PART 1 — LEAD NUDGES
    // =========================================================================

    // Fetch all 'new' leads so we can check their message history in JS.
    // Two-hour and 24-hour boundaries.
    const twoHoursAgo = hoursAgo(2);
    const twentyFourHoursAgo = hoursAgo(24);

    const { data: newLeads, error: leadsError } = await supabase
      .from('leads')
      .select('id, phone, name, created_at')
      .eq('status', 'new');

    if (leadsError) {
      console.error('nudge-dropped: failed to fetch leads:', leadsError.message);
      summary.errors.push({ context: 'fetch_leads', reason: leadsError.message });
    }

    for (const lead of newLeads || []) {
      try {
        const createdAt = new Date(lead.created_at);

        // --- Drop leads older than 24 hours with no conversion ---
        if (createdAt < twentyFourHoursAgo) {
          const { error: dropError } = await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);

          if (dropError) {
            console.error(`Failed to drop lead ${maskPhone(lead.phone)}:`, dropError.message);
            summary.errors.push({ phone: maskPhone(lead.phone), reason: dropError.message });
          } else {
            summary.leads_dropped++;
            console.log(`Lead dropped (>24h): ${maskPhone(lead.phone)}`);
          }
          continue; // Skip nudge — lead is now dropped
        }

        // --- 2-hour nudge window: lead is between 2h and 24h old ---
        if (createdAt < twoHoursAgo) {
          // Check if we've sent any outbound message to this lead in the last 2 hours
          const { data: recentMessages } = await supabase
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('direction', 'out')
            .gte('sent_at', twoHoursAgo.toISOString())
            .limit(1);

          const hasRecentMessage = recentMessages && recentMessages.length > 0;

          if (!hasRecentMessage) {
            // Send the trial nudge
            const result = await sendWhatsApp(
              lead.phone,
              'nudge_trial',
              [lead.name || 'there'],
              false // isClient = false → subject to rate limiting
            );

            if (result.success) {
              summary.lead_nudges_sent++;
              console.log(`2h lead nudge sent to ${maskPhone(lead.phone)}`);
            } else if (result.reason !== 'rate_limited') {
              summary.errors.push({ phone: maskPhone(lead.phone), reason: result.reason });
            }
          }
        }
      } catch (leadErr) {
        console.error(`Lead nudge error for ${maskPhone(lead.phone)}:`, leadErr.message);
        summary.errors.push({ phone: maskPhone(lead.phone), reason: leadErr.message });
      }
    }

    // =========================================================================
    // PART 2 — CHECK-IN NUDGES
    // =========================================================================

    const now = new Date();
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;

    // Fetch all active clients
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (clientsError) {
      console.error('nudge-dropped: failed to fetch clients:', clientsError.message);
      summary.errors.push({ context: 'fetch_clients', reason: clientsError.message });
    }

    for (const client of clients || []) {
      try {
        if (!client.program_started_at) continue;

        const startedAt = new Date(client.program_started_at);
        const weeksSinceStart = Math.floor((now - startedAt) / msPerWeek);
        const currentWeek = Math.max(1, weeksSinceStart + 1);

        // --- Check if the client already submitted a check-in for the current week ---
        const { data: currentCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .maybeSingle();

        if (currentCheckin) continue; // Already submitted — nothing to do

        // --- Find the check-in form message sent to this client in the last 7 days ---
        const sevenDaysAgo = daysAgo(7);

        const { data: formMessages } = await supabase
          .from('messages')
          .select('id, sent_at')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .eq('template_name', 'weekly_checkin')
          .gte('sent_at', sevenDaysAgo.toISOString())
          .order('sent_at', { ascending: false })
          .limit(1);

        // If we never sent the form, nothing to nudge about
        if (!formMessages || formMessages.length === 0) continue;

        const formSentAt = new Date(formMessages[0].sent_at);
        const hoursSinceForm = (now - formSentAt) / (60 * 60 * 1000);

        if (hoursSinceForm >= 24 && hoursSinceForm < 48) {
          // --- First nudge (24–48h after form sent) ---
          const result = await sendWhatsApp(
            client.phone,
            'checkin_nudge',
            [client.name || 'there', String(currentWeek)],
            true
          );

          if (result.success) {
            summary.checkin_first_nudges++;
            console.log(`First check-in nudge sent to ${maskPhone(client.phone)}, week ${currentWeek}`);
          } else {
            summary.errors.push({ phone: maskPhone(client.phone), reason: result.reason });
          }
        } else if (hoursSinceForm >= 48 && hoursSinceForm < 72) {
          // --- Final nudge (48–72h after form sent) ---
          const result = await sendWhatsApp(
            client.phone,
            'checkin_nudge_final',
            [client.name || 'there', String(currentWeek)],
            true
          );

          if (result.success) {
            summary.checkin_final_nudges++;
            console.log(`Final check-in nudge sent to ${maskPhone(client.phone)}, week ${currentWeek}`);
          } else {
            summary.errors.push({ phone: maskPhone(client.phone), reason: result.reason });
          }
        }

        // --- Check for 2 consecutive missed weeks → escalate ---
        if (currentWeek >= 2) {
          const prevWeek = currentWeek - 1;

          const { data: prevCheckin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', prevWeek)
            .maybeSingle();

          if (!prevCheckin) {
            // Two consecutive weeks missed — check if we already escalated for this
            const { data: existingEscalation } = await supabase
              .from('escalations')
              .select('id')
              .eq('client_id', client.id)
              .eq('trigger_type', 'missed_checkins')
              .eq('resolved', false)
              .maybeSingle();

            if (!existingEscalation) {
              await createEscalation(
                client.phone,
                'missed_checkins',
                `Client missed check-ins for weeks ${prevWeek} and ${currentWeek}`,
                client.id
              );
              summary.checkin_escalations++;
              console.log(`Escalation created for ${maskPhone(client.phone)}: 2 missed check-ins`);
            }
          }
        }
      } catch (clientErr) {
        console.error(`Check-in nudge error for ${maskPhone(client.phone)}:`, clientErr.message);
        summary.errors.push({ phone: maskPhone(client.phone), reason: clientErr.message });
      }
    }

    // Clean up empty errors array
    if (summary.errors.length === 0) delete summary.errors;

    console.log('nudge-dropped cron summary:', JSON.stringify(summary));
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
