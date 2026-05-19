const { supabase } = require("../../lib/supabase");
const { sendWhatsApp } = require("../../lib/whatsapp");
const { maskPhone } = require("../../lib/utils");

/**
 * Cron: Weekly check-in reminder
 * Schedule: Every Sunday 9 AM IST (3:30 AM UTC) — "30 3 * * 0"
 *
 * For each active client whose program hasn't ended, calculate the
 * current week number and send a WhatsApp check-in form link.
 */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    // ── Verify cron secret (optional; Vercel injects the header) ──
    const authHeader = req.headers["authorization"];
    if (
      process.env.CRON_SECRET &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const now = new Date();

    // ── Fetch active clients whose program hasn't ended ───────────
    const { data: clients, error: clientsErr } = await supabase
      .from("clients")
      .select("id, name, phone, program_started_at, program_ends_at")
      .eq("status", "active")
      .gt("program_ends_at", now.toISOString());

    if (clientsErr) {
      console.error("[weekly-checkin] Failed to query clients:", clientsErr.message);
      return res.status(500).json({ error: "Failed to query clients" });
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: "No active clients to notify", sent: 0 });
    }

    let sent = 0;
    let skipped = 0;
    const errors = [];

    for (const client of clients) {
      try {
        // ── Calculate current week number ──────────────────────────
        const startDate = new Date(client.program_started_at);
        const diffMs = now.getTime() - startDate.getTime();
        const weekNo = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));

        if (weekNo < 1) {
          skipped++;
          continue;
        }

        // ── Build check-in form URL ────────────────────────────────
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        // ── Send WhatsApp template ─────────────────────────────────
        const result = await sendWhatsApp(client.phone, "weekly_checkin", {
          name: client.name,
          templateParams: [client.name, String(weekNo), checkinUrl],
        });

        if (result.skipped) {
          skipped++;
        } else {
          sent++;
        }

        console.log(
          `[weekly-checkin] ${result.skipped ? "Skipped" : "Sent"} week ${weekNo} check-in to ${maskPhone(client.phone)}`
        );
      } catch (err) {
        console.error(
          `[weekly-checkin] Error processing client ${client.id}: ${err.message}`
        );
        errors.push({ client_id: client.id, error: err.message });
      }
    }

    return res.status(200).json({
      message: "Weekly check-in cron complete",
      total_clients: clients.length,
      sent,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("[weekly-checkin] Unexpected error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
