// api/cron/weekly-checkin.js — Sunday 03:30 UTC (9:00 AM IST) cron
// Sends weekly check-in form links to all active clients.
// GET /api/cron/weekly-checkin

const {
  supabase,
  getActiveClients,
  logMessage,
} = require("../../lib/supabase");
const { sendTemplate } = require("../../lib/whatsapp");
const { maskPhone } = require("../../lib/utils");

// Program duration in weeks by program slug
const PROGRAM_DURATION = {
  "6wk_gym": 6,
  "6wk_home": 6,
  "12wk": 12,
  pcos: 12,
  "40plus": 12,
  zoom_trial: 1,
  zoom_pack: 4,
};

module.exports = async (req, res) => {
  // ── Verify Vercel cron authorization ─────────────────────────────
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const summary = { sent: 0, skipped: 0, errors: 0 };

  try {
    const clients = await getActiveClients();

    if (!clients || clients.length === 0) {
      console.log("[weekly-checkin] No active clients found");
      return res.status(200).json(summary);
    }

    const now = new Date();

    for (const client of clients) {
      try {
        // ── Calculate current week number ──────────────────────────
        if (!client.program_started_at) {
          console.log(
            `[weekly-checkin] Skipping ${maskPhone(client.phone)}: no program_started_at`
          );
          summary.skipped++;
          continue;
        }

        const startDate = new Date(client.program_started_at);
        const msElapsed = now.getTime() - startDate.getTime();
        const weekNo = Math.ceil(msElapsed / (7 * 24 * 60 * 60 * 1000));

        if (weekNo < 1) {
          summary.skipped++;
          continue;
        }

        // ── Check program duration ─────────────────────────────────
        const maxWeeks = PROGRAM_DURATION[client.program] || 12;
        if (weekNo > maxWeeks) {
          // Program finished — mark as completed
          await supabase
            .from("clients")
            .update({ status: "completed" })
            .eq("id", client.id);

          console.log(
            `[weekly-checkin] ${maskPhone(client.phone)} completed (week ${weekNo} > ${maxWeeks})`
          );
          summary.skipped++;
          continue;
        }

        // ── Check if checkin already submitted this week ───────────
        const { data: existing } = await supabase
          .from("checkins")
          .select("id")
          .eq("client_id", client.id)
          .eq("week_no", weekNo)
          .maybeSingle();

        if (existing) {
          summary.skipped++;
          continue;
        }

        // ── Send WhatsApp check-in link ────────────────────────────
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, "weekly_checkin", {
          name: client.name || "there",
          templateParams: [
            client.name || "there",
            String(weekNo),
            checkinUrl,
          ],
        });

        // Log the outbound message
        await logMessage(
          client.phone,
          "out",
          `Weekly check-in link sent for week ${weekNo}: ${checkinUrl}`,
          "weekly_checkin"
        );

        console.log(
          `[weekly-checkin] Sent to ${maskPhone(client.phone)} — week ${weekNo}`
        );
        summary.sent++;
      } catch (clientErr) {
        console.error(
          `[weekly-checkin] Error for ${maskPhone(client.phone)}:`,
          clientErr.message
        );
        summary.errors++;
      }
    }

    console.log("[weekly-checkin] Summary:", JSON.stringify(summary));
    return res.status(200).json(summary);
  } catch (err) {
    console.error("[weekly-checkin] Fatal error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
