const { supabase } = require("../lib/supabase");
const { sendTemplate } = require("../lib/whatsapp");
const { maskPhone } = require("../lib/utils");

/**
 * Weekly check-in cron — runs every Sunday at 9 AM IST (03:30 UTC).
 * Sends a personalised check-in form link to every active client.
 */

const PROGRAM_DURATION = {
  "6wk_gym": 6,
  "6wk_home": 6,
  "12wk": 12,
  pcos: 6,
  "40plus": 6,
  zoom_trial: 1,
  zoom_pack: 4,
};

function weeksBetween(startDate, now) {
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const diff = now.getTime() - new Date(startDate).getTime();
  return Math.floor(diff / msPerWeek) + 1; // week 1 = first week
}

async function handler(req, res) {
  try {
    // 1. Authenticate — only Vercel Cron may call this endpoint
    const authHeader = req.headers["authorization"];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 2. Fetch all active clients
    const { data: clients, error: fetchErr } = await supabase
      .from("clients")
      .select("id, phone, program, program_started_at")
      .eq("status", "active");

    if (fetchErr) {
      console.error("Failed to fetch active clients:", fetchErr.message);
      return res.status(500).json({ error: "Database query failed" });
    }

    if (!clients || clients.length === 0) {
      console.log("No active clients found.");
      return res.status(200).json({ sent: 0 });
    }

    const now = new Date();
    let sent = 0;

    // 3. Process each client
    for (const client of clients) {
      const { id, phone, program, program_started_at } = client;

      if (!program_started_at) {
        console.warn(
          `Client ${maskPhone(phone)} has no program_started_at — skipping.`
        );
        continue;
      }

      const weekNo = weeksBetween(program_started_at, now);
      const maxWeeks = PROGRAM_DURATION[program] || 12;

      // If the client has exceeded their program duration, mark as completed
      if (weekNo > maxWeeks) {
        const { error: updateErr } = await supabase
          .from("clients")
          .update({ status: "completed" })
          .eq("id", id);

        if (updateErr) {
          console.error(
            `Failed to mark ${maskPhone(phone)} as completed:`,
            updateErr.message
          );
        } else {
          console.log(
            `Client ${maskPhone(phone)} completed program ${program} (week ${weekNo}/${maxWeeks}).`
          );
        }
        continue;
      }

      // Build check-in form link
      const formLink = `https://fitnessbymaddy.com/checkin?c=${id}&w=${weekNo}`;

      // Send WhatsApp template
      const result = await sendTemplate(phone, "weekly_checkin", [
        String(weekNo),
        formLink,
      ]);

      if (result.success) {
        sent++;
        console.log(
          `Sent week-${weekNo} check-in to ${maskPhone(phone)}.`
        );
      } else {
        console.error(
          `Failed to send check-in to ${maskPhone(phone)}: ${result.reason}`
        );
      }
    }

    return res.status(200).json({ sent });
  } catch (err) {
    console.error("weekly-checkin cron error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = handler;
