const { supabase } = require("../../lib/supabase");
const { sendWhatsApp } = require("../../lib/whatsapp");
const { maskPhone } = require("../../lib/utils");

/**
 * Cron: Nudge & drop stale leads + remind clients about check-ins
 * Schedule: Daily at 6 AM UTC — "0 6 * * *"
 *
 * A) Nudge new leads with no reply after 2 hours (send nudge_trial)
 * B) Drop leads with no reply after 24 hours (set status → dropped)
 * C) Remind active clients who haven't submitted their weekly check-in
 */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    // ── Verify cron secret ────────────────────────────────────────
    const authHeader = req.headers["authorization"];
    if (
      process.env.CRON_SECRET &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const summary = {
      nudged_leads: 0,
      dropped_leads: 0,
      checkin_reminders: 0,
      errors: [],
    };

    // ════════════════════════════════════════════════════════════════
    // A) Nudge new leads with no reply after 2 hours
    // ════════════════════════════════════════════════════════════════
    try {
      const { data: staleLeads, error: leadsErr } = await supabase
        .from("leads")
        .select("id, phone, name")
        .eq("status", "new")
        .lt("created_at", twoHoursAgo);

      if (leadsErr) {
        console.error("[nudge-dropped] Failed to query stale leads:", leadsErr.message);
        summary.errors.push({ job: "nudge_leads", error: leadsErr.message });
      } else if (staleLeads && staleLeads.length > 0) {
        for (const lead of staleLeads) {
          try {
            // Check if we already sent a nudge_trial to this phone
            const { data: existing } = await supabase
              .from("messages")
              .select("id")
              .eq("phone", lead.phone)
              .eq("direction", "out")
              .eq("template_name", "nudge_trial")
              .limit(1);

            if (existing && existing.length > 0) {
              continue; // Already nudged
            }

            const trialLink = "https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial";

            const result = await sendWhatsApp(lead.phone, "nudge_trial", {
              name: lead.name || "there",
              templateParams: [lead.name || "there", trialLink],
            });

            if (!result.skipped) {
              summary.nudged_leads++;
              console.log(
                `[nudge-dropped] Sent nudge_trial to ${maskPhone(lead.phone)}`
              );
            }
          } catch (err) {
            console.error(
              `[nudge-dropped] Error nudging lead ${lead.id}: ${err.message}`
            );
            summary.errors.push({ job: "nudge_lead", lead_id: lead.id, error: err.message });
          }
        }
      }
    } catch (err) {
      console.error("[nudge-dropped] Nudge leads job failed:", err.message);
      summary.errors.push({ job: "nudge_leads", error: err.message });
    }

    // ════════════════════════════════════════════════════════════════
    // B) Drop leads with no reply after 24 hours
    // ════════════════════════════════════════════════════════════════
    try {
      const { data: dropLeads, error: dropErr } = await supabase
        .from("leads")
        .select("id, phone")
        .eq("status", "new")
        .lt("created_at", twentyFourHoursAgo);

      if (dropErr) {
        console.error("[nudge-dropped] Failed to query drop leads:", dropErr.message);
        summary.errors.push({ job: "drop_leads", error: dropErr.message });
      } else if (dropLeads && dropLeads.length > 0) {
        const dropIds = dropLeads.map((l) => l.id);

        const { error: updateErr } = await supabase
          .from("leads")
          .update({ status: "dropped" })
          .in("id", dropIds);

        if (updateErr) {
          console.error("[nudge-dropped] Failed to drop leads:", updateErr.message);
          summary.errors.push({ job: "drop_leads", error: updateErr.message });
        } else {
          summary.dropped_leads = dropIds.length;
          console.log(`[nudge-dropped] Dropped ${dropIds.length} stale leads`);
        }
      }
    } catch (err) {
      console.error("[nudge-dropped] Drop leads job failed:", err.message);
      summary.errors.push({ job: "drop_leads", error: err.message });
    }

    // ════════════════════════════════════════════════════════════════
    // C) Remind clients who haven't submitted their weekly check-in
    // ════════════════════════════════════════════════════════════════
    try {
      // Find active clients whose program is running
      const { data: activeClients, error: clientsErr } = await supabase
        .from("clients")
        .select("id, name, phone, program_started_at")
        .eq("status", "active")
        .gt("program_ends_at", now.toISOString());

      if (clientsErr) {
        console.error("[nudge-dropped] Failed to query clients:", clientsErr.message);
        summary.errors.push({ job: "checkin_reminders", error: clientsErr.message });
      } else if (activeClients && activeClients.length > 0) {
        for (const client of activeClients) {
          try {
            // Calculate current week number
            const startDate = new Date(client.program_started_at);
            const diffMs = now.getTime() - startDate.getTime();
            const weekNo = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));

            if (weekNo < 1) continue;

            // Check if a check-in was submitted for this week
            const { data: checkins } = await supabase
              .from("checkins")
              .select("id, submitted_at, sent_at")
              .eq("client_id", client.id)
              .eq("week_no", weekNo)
              .limit(1);

            // If there's a check-in record that was sent but not submitted,
            // and it was sent 24+ hours ago, send a reminder
            if (checkins && checkins.length > 0) {
              const checkin = checkins[0];
              if (checkin.submitted_at) continue; // Already submitted

              const sentAt = new Date(checkin.sent_at);
              const hoursSinceSent = (now.getTime() - sentAt.getTime()) / (60 * 60 * 1000);

              if (hoursSinceSent < 24) continue; // Not yet 24 hours
            } else {
              // No check-in record at all — skip (the weekly-checkin cron
              // hasn't run yet for this week, or client just started)
              continue;
            }

            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

            const result = await sendWhatsApp(client.phone, "checkin_reminder", {
              name: client.name,
              templateParams: [client.name, String(weekNo), checkinUrl],
            });

            if (!result.skipped) {
              summary.checkin_reminders++;
              console.log(
                `[nudge-dropped] Sent checkin_reminder to ${maskPhone(client.phone)} for week ${weekNo}`
              );
            }
          } catch (err) {
            console.error(
              `[nudge-dropped] Error reminding client ${client.id}: ${err.message}`
            );
            summary.errors.push({
              job: "checkin_reminder",
              client_id: client.id,
              error: err.message,
            });
          }
        }
      }
    } catch (err) {
      console.error("[nudge-dropped] Checkin reminders job failed:", err.message);
      summary.errors.push({ job: "checkin_reminders", error: err.message });
    }

    return res.status(200).json({
      message: "Nudge-dropped cron complete",
      ...summary,
      errors: summary.errors.length > 0 ? summary.errors : undefined,
    });
  } catch (err) {
    console.error("[nudge-dropped] Unexpected error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
