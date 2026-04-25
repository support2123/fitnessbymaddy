const { getSupabase } = require("../../lib/supabase");
const { sendTemplate } = require("../../lib/whatsapp");

const MADDY_PHONE = process.env.MADDY_PHONE || "+917082478374";

/* ---------- helpers ---------- */

function maskPII(text) {
  if (!text) return text;
  return text
    .replace(/\+?\d{10,15}/g, "***PHONE***")
    .replace(/[\w.-]+@[\w.-]+/g, "***EMAIL***");
}

/* ---------- handler ---------- */

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    /* ---- verify cron authorization ---- */
    const authHeader = req.headers["authorization"];
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabase = getSupabase();
    const now = new Date();

    const summary = {
      lead_nudges_sent: 0,
      leads_dropped: 0,
      reengage_sent: 0,
      checkin_nudges_sent: 0,
      checkin_escalations: 0,
      errors: 0,
    };

    // =================================================================
    // A) Lead nudges (Flow A)
    // =================================================================

    try {
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      // A1: Leads where status='new' and last_msg_at is >2 hours ago but <24 hours
      //     Send nudge template pushing $20 trial link
      const { data: nudgeLeads } = await supabase
        .from("leads")
        .select("*")
        .eq("status", "new")
        .lt("last_msg_at", twoHoursAgo)
        .gte("last_msg_at", twentyFourHoursAgo);

      if (nudgeLeads && nudgeLeads.length > 0) {
        for (const lead of nudgeLeads) {
          try {
            if (!lead.phone) continue;

            await sendTemplate(lead.phone, "nudge_trial", [
              lead.name || "there",
            ]);

            summary.lead_nudges_sent++;
          } catch (err) {
            console.error(`Lead nudge failed for lead ${lead.id}:`, maskPII(err.message));
            summary.errors++;
          }
        }
      }

      // A2: Leads where status='new' and last_msg_at is >24 hours ago
      //     Mark as dropped
      const { data: dropLeads } = await supabase
        .from("leads")
        .select("id")
        .eq("status", "new")
        .lt("last_msg_at", twentyFourHoursAgo);

      if (dropLeads && dropLeads.length > 0) {
        const dropIds = dropLeads.map((l) => l.id);

        const { error: dropErr } = await supabase
          .from("leads")
          .update({ status: "dropped" })
          .in("id", dropIds);

        if (dropErr) {
          console.error("Failed to drop leads:", dropErr.message);
          summary.errors++;
        } else {
          summary.leads_dropped = dropIds.length;
        }
      }
    } catch (err) {
      console.error("Lead nudge job (A) failed:", maskPII(err.message));
      summary.errors++;
    }

    // =================================================================
    // B) Dropped lead re-engagement (7-day rule)
    // =================================================================

    try {
      // Find leads where status='dropped' and created_at was ~7 days ago (within a 1-day window)
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

      const { data: reengageLeads } = await supabase
        .from("leads")
        .select("*")
        .eq("status", "dropped")
        .gte("created_at", eightDaysAgo)
        .lt("created_at", sevenDaysAgo);

      if (reengageLeads && reengageLeads.length > 0) {
        for (const lead of reengageLeads) {
          try {
            if (!lead.phone) continue;

            // Only send once: check messages table for prior reengage_v1
            const { data: existingMsg } = await supabase
              .from("messages")
              .select("id")
              .eq("phone", lead.phone)
              .eq("template_name", "reengage_v1")
              .limit(1);

            if (existingMsg && existingMsg.length > 0) {
              // Already sent reengage_v1 to this lead, skip
              continue;
            }

            await sendTemplate(lead.phone, "reengage_v1", [
              lead.name || "there",
            ]);

            summary.reengage_sent++;
          } catch (err) {
            console.error(`Re-engage failed for lead ${lead.id}:`, maskPII(err.message));
            summary.errors++;
          }
        }
      }
    } catch (err) {
      console.error("Re-engagement job (B) failed:", maskPII(err.message));
      summary.errors++;
    }

    // =================================================================
    // C) Missed check-in nudges
    // =================================================================

    try {
      // Fetch all active clients
      const { data: activeClients } = await supabase
        .from("clients")
        .select("*")
        .eq("status", "active");

      if (activeClients && activeClients.length > 0) {
        for (const client of activeClients) {
          try {
            if (!client.phone) continue;

            // Calculate current week number from program start
            const programStart = new Date(client.program_started_at);
            const msElapsed = now.getTime() - programStart.getTime();
            const currentWeek = Math.floor(msElapsed / (7 * 24 * 60 * 60 * 1000)) + 1;

            // Check if check-in was submitted this week
            const { data: checkin } = await supabase
              .from("checkins")
              .select("id")
              .eq("client_id", client.id)
              .eq("week_no", currentWeek)
              .limit(1);

            if (checkin && checkin.length > 0) {
              // Already submitted, no nudge needed
              continue;
            }

            // Find the most recent weekly_checkin message sent to this client
            const { data: checkinMsg } = await supabase
              .from("messages")
              .select("sent_at")
              .eq("phone", client.phone)
              .eq("template_name", "weekly_checkin")
              .order("sent_at", { ascending: false })
              .limit(1);

            if (!checkinMsg || checkinMsg.length === 0) {
              // No check-in form was sent yet, skip
              continue;
            }

            const sentAt = new Date(checkinMsg[0].sent_at);
            const hoursSinceSent = (now.getTime() - sentAt.getTime()) / (1000 * 60 * 60);

            // 24-hour nudge (sent between 24h and 48h after form was sent)
            if (hoursSinceSent >= 24 && hoursSinceSent < 48) {
              await sendTemplate(client.phone, "checkin_nudge", [
                client.name || "there",
                String(currentWeek),
              ]);
              summary.checkin_nudges_sent++;
            }
            // 48-hour final nudge (sent after 48h)
            else if (hoursSinceSent >= 48) {
              await sendTemplate(client.phone, "checkin_final_nudge", [
                client.name || "there",
                String(currentWeek),
              ]);
              summary.checkin_nudges_sent++;
            }

            // Check for 2 consecutive missed weeks -> escalate to Maddy
            if (currentWeek >= 2) {
              const { data: prevCheckin } = await supabase
                .from("checkins")
                .select("id")
                .eq("client_id", client.id)
                .eq("week_no", currentWeek - 1)
                .limit(1);

              const prevMissed = !prevCheckin || prevCheckin.length === 0;
              const currentMissed = !checkin || checkin.length === 0;

              if (prevMissed && currentMissed && hoursSinceSent >= 48) {
                // 2 consecutive weeks missed - escalate
                await sendTemplate(MADDY_PHONE, "escalation_alert", [
                  client.name || "Client",
                  "2 consecutive check-ins missed",
                  `Client ${client.name || client.id} has missed weeks ${currentWeek - 1} and ${currentWeek}`,
                ]).catch((err) =>
                  console.error("Escalation notify failed:", err.message)
                );

                summary.checkin_escalations++;
              }
            }
          } catch (err) {
            console.error(
              `Check-in nudge failed for client ${client.id}:`,
              maskPII(err.message)
            );
            summary.errors++;
          }
        }
      }
    } catch (err) {
      console.error("Missed check-in job (C) failed:", maskPII(err.message));
      summary.errors++;
    }

    return res.status(200).json(summary);
  } catch (err) {
    console.error("nudge-dropped cron error:", maskPII(err.message));
    // Return 200 for crons even on internal errors
    return res.status(200).json({ error: "Internal error" });
  }
};
