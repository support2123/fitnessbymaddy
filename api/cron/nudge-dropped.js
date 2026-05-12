// api/cron/nudge-dropped.js — Daily cron (06:00 UTC)
// 1. Re-engage dropped leads (7–30 day window, max 50/run)
// 2. Nudge active clients with pending check-ins (24h / 48h)
// 3. Escalate clients who missed 2+ consecutive check-ins
// GET /api/cron/nudge-dropped

const {
  supabase,
  getActiveClients,
  logMessage,
} = require("../../lib/supabase");
const { sendTemplate, sendTextMessage } = require("../../lib/whatsapp");
const { maskPhone } = require("../../lib/utils");

const MADDY_PHONE = "+917082478374";
const MAX_REENGAGE_PER_RUN = 50;

module.exports = async (req, res) => {
  // ── Verify Vercel cron authorization ─────────────────────────────
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const summary = { reengaged: 0, nudged: 0, escalated: 0, errors: 0 };

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ───────────────────────────────────────────────────────────────
    // PART 1: Re-engage dropped leads
    // ───────────────────────────────────────────────────────────────
    try {
      const { data: droppedLeads, error: leadsErr } = await supabase
        .from("leads")
        .select("*")
        .eq("status", "dropped")
        .lt("last_msg_at", sevenDaysAgo.toISOString()) // at least 7 days since last msg
        .gt("last_msg_at", thirtyDaysAgo.toISOString()) // no older than 30 days
        .order("last_msg_at", { ascending: true })
        .limit(MAX_REENGAGE_PER_RUN);

      if (leadsErr) throw leadsErr;

      for (const lead of droppedLeads || []) {
        try {
          await sendTemplate(lead.phone, "win_back", {
            name: lead.name || "there",
            templateParams: [lead.name || "there", "$20"],
          });

          // Update last_msg_at so we don't re-contact them next run
          await supabase
            .from("leads")
            .update({ last_msg_at: now.toISOString() })
            .eq("id", lead.id);

          await logMessage(
            lead.phone,
            "out",
            "Win-back template sent ($20 zoom trial offer)",
            "win_back"
          );

          console.log(
            `[nudge-dropped] Re-engaged ${maskPhone(lead.phone)}`
          );
          summary.reengaged++;
        } catch (sendErr) {
          console.error(
            `[nudge-dropped] Failed to re-engage ${maskPhone(lead.phone)}:`,
            sendErr.message
          );
          summary.errors++;
        }
      }
    } catch (partErr) {
      console.error(
        "[nudge-dropped] Re-engage query error:",
        partErr.message
      );
      summary.errors++;
    }

    // ───────────────────────────────────────────────────────────────
    // PART 2 & 3: Nudge pending check-ins + escalation
    // ───────────────────────────────────────────────────────────────
    try {
      const clients = await getActiveClients();
      const twentyFourHoursAgo = new Date(
        now.getTime() - 24 * 60 * 60 * 1000
      );
      const fortyEightHoursAgo = new Date(
        now.getTime() - 48 * 60 * 60 * 1000
      );

      for (const client of clients || []) {
        try {
          if (!client.program_started_at) continue;

          const startDate = new Date(client.program_started_at);
          const msElapsed = now.getTime() - startDate.getTime();
          const currentWeek = Math.ceil(
            msElapsed / (7 * 24 * 60 * 60 * 1000)
          );

          if (currentWeek < 1) continue;

          // ── Find the most recently submitted checkin ──────────────
          const { data: latestCheckin } = await supabase
            .from("checkins")
            .select("id, week_no")
            .eq("client_id", client.id)
            .order("week_no", { ascending: false })
            .limit(1)
            .maybeSingle();

          const lastSubmittedWeek = latestCheckin
            ? latestCheckin.week_no
            : 0;
          const weeksMissed = currentWeek - lastSubmittedWeek;

          // ── Escalate: 2+ consecutive missed check-ins ────────────
          if (weeksMissed >= 2) {
            const alertMsg =
              `ESCALATION: ${client.name || maskPhone(client.phone)} ` +
              `has missed ${weeksMissed} consecutive check-ins ` +
              `(last submitted: week ${lastSubmittedWeek}, current: week ${currentWeek}).`;

            try {
              await sendTextMessage(MADDY_PHONE, alertMsg);
              await logMessage(MADDY_PHONE, "out", alertMsg, null);
            } catch (escErr) {
              console.error(
                "[nudge-dropped] Escalation send failed:",
                escErr.message
              );
            }

            console.log(
              `[nudge-dropped] Escalated ${maskPhone(client.phone)}: ${weeksMissed} missed`
            );
            summary.escalated++;
            continue; // don't also nudge if escalating
          }

          // ── Nudge: current week not yet submitted ────────────────
          if (weeksMissed >= 1) {
            // Find when the checkin request was sent for this week
            const { data: sentMsg } = await supabase
              .from("messages")
              .select("sent_at")
              .eq("phone", client.phone)
              .eq("template_name", "weekly_checkin")
              .order("sent_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (!sentMsg) continue; // no checkin request sent yet

            const sentAt = new Date(sentMsg.sent_at);

            // Determine nudge level based on elapsed time
            let nudgeTemplate = null;
            if (sentAt < fortyEightHoursAgo) {
              nudgeTemplate = "checkin_nudge_48h";
            } else if (sentAt < twentyFourHoursAgo) {
              nudgeTemplate = "checkin_nudge_24h";
            }

            if (!nudgeTemplate) continue;

            // Avoid duplicate nudges — check if we already sent this one
            const { data: existingNudge } = await supabase
              .from("messages")
              .select("id")
              .eq("phone", client.phone)
              .eq("template_name", nudgeTemplate)
              .gte("sent_at", sentAt.toISOString())
              .maybeSingle();

            if (existingNudge) continue; // already nudged at this level

            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

            await sendTemplate(client.phone, nudgeTemplate, {
              name: client.name || "there",
              templateParams: [client.name || "there", checkinUrl],
            });

            await logMessage(
              client.phone,
              "out",
              `Check-in nudge (${nudgeTemplate}) sent for week ${currentWeek}`,
              nudgeTemplate
            );

            console.log(
              `[nudge-dropped] Nudged ${maskPhone(client.phone)} (${nudgeTemplate})`
            );
            summary.nudged++;
          }
        } catch (clientErr) {
          console.error(
            `[nudge-dropped] Error for client ${maskPhone(client.phone)}:`,
            clientErr.message
          );
          summary.errors++;
        }
      }
    } catch (partErr) {
      console.error(
        "[nudge-dropped] Client nudge error:",
        partErr.message
      );
      summary.errors++;
    }

    console.log("[nudge-dropped] Summary:", JSON.stringify(summary));
    return res.status(200).json(summary);
  } catch (err) {
    console.error("[nudge-dropped] Fatal error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
