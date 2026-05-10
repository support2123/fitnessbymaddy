const { query } = require("../lib/supabase");
const { sendTemplate, maskPhone } = require("../lib/whatsapp");
const { generateToken } = require("../lib/utils");

const CRON_SECRET = process.env.CRON_SECRET;
const MADDY_PHONE = process.env.MADDY_PHONE;
const BASE_DOMAIN = "https://fitnessbymaddy.com";

/**
 * GET /api/cron/weekly-checkin
 * Cron: runs every Sunday at 9am IST (3:30 UTC).
 * Sends weekly check-in form links to all active clients.
 * Protected by CRON_SECRET via Authorization header.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Auth (Vercel Cron sends Authorization: Bearer <CRON_SECRET>) ──
  const authHeader = req.headers.authorization || "";
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    console.warn("[weekly-checkin] Unauthorized cron request");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const results = { sent: 0, skipped: 0, errors: 0, escalated: 0 };

  try {
    // ── Fetch all active clients ────────────────────────────────────
    const clients = await query("clients", {
      select: "id, phone, name, program, program_weeks, program_started_at",
      filters: { status: "eq.active" },
    });

    console.log(`[weekly-checkin] Found ${clients.length} active clients`);

    for (const client of clients) {
      try {
        await processClient(client, results);
      } catch (clientErr) {
        console.error(
          `[weekly-checkin] Error processing client=${client.id} (${maskPhone(client.phone || "unknown")}):`,
          clientErr.message
        );
        results.errors++;
      }
    }

    console.log(
      `[weekly-checkin] Complete — sent=${results.sent} skipped=${results.skipped} errors=${results.errors} escalated=${results.escalated}`
    );

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error("[weekly-checkin] Unhandled error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

async function processClient(client, results) {
  const {
    id: clientId,
    phone,
    program,
    program_weeks,
    program_started_at,
  } = client;

  if (!program_started_at) {
    console.log(
      `[weekly-checkin] Skipping client=${clientId} — no program_started_at`
    );
    results.skipped++;
    return;
  }

  // ── Calculate current week number ─────────────────────────────────
  const startDate = new Date(program_started_at);
  const now = new Date();
  const daysSinceStart = Math.floor(
    (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const weekNo = Math.floor(daysSinceStart / 7) + 1;

  // Determine max duration (default 6 for standard, 12 for 12wk)
  const maxWeeks = program_weeks
    || (program === "12wk" ? 12 : 6);

  if (weekNo > maxWeeks) {
    console.log(
      `[weekly-checkin] Skipping client=${clientId} — week ${weekNo} exceeds program duration (${maxWeeks})`
    );
    results.skipped++;
    return;
  }

  console.log(
    `[weekly-checkin] Processing client=${clientId} (${maskPhone(phone || "unknown")}) week=${weekNo}/${maxWeeks}`
  );

  // ── Check for missed check-ins ────────────────────────────────────
  if (weekNo >= 3) {
    try {
      const recentCheckins = await query("checkins", {
        select: "week_no",
        filters: {
          client_id: `eq.${clientId}`,
          week_no: `in.(${weekNo - 1},${weekNo - 2})`,
        },
      });

      const submittedWeeks = new Set(recentCheckins.map((c) => c.week_no));
      const missedPrev = !submittedWeeks.has(weekNo - 1);
      const missedPrevPrev = !submittedWeeks.has(weekNo - 2);

      if (missedPrev && missedPrevPrev) {
        console.warn(
          `[weekly-checkin] ESCALATION — client=${clientId} missed 2 consecutive check-ins (weeks ${weekNo - 2}, ${weekNo - 1})`
        );
        results.escalated++;

        try {
          const { sendText } = require("../lib/whatsapp");
          await sendText(
            MADDY_PHONE,
            `⚠️ MISSED CHECK-INS — Client ${client.name || clientId} (${maskPhone(phone || "unknown")}) has missed 2 consecutive check-ins (weeks ${weekNo - 2} and ${weekNo - 1}). Please follow up.`
          );
        } catch (notifyErr) {
          console.error(
            `[weekly-checkin] Failed to notify Maddy about missed check-ins for client=${clientId}:`,
            notifyErr.message
          );
        }
      }
    } catch (checkinErr) {
      console.error(
        `[weekly-checkin] Failed to check missed check-ins for client=${clientId}:`,
        checkinErr.message
      );
    }
  }

  // ── Generate token and send check-in link ─────────────────────────
  const token = generateToken({ client_id: clientId, week_no: weekNo });
  const checkinUrl = `${BASE_DOMAIN}/checkin.html?c=${encodeURIComponent(clientId)}&w=${weekNo}&t=${encodeURIComponent(token)}`;

  try {
    await sendTemplate(phone, "weekly_checkin", [
      client.name || "there",
      String(weekNo),
      checkinUrl,
    ]);
    console.log(
      `[weekly-checkin] Sent check-in link to ${maskPhone(phone || "unknown")} for week ${weekNo}`
    );
    results.sent++;
  } catch (sendErr) {
    console.error(
      `[weekly-checkin] Failed to send check-in to ${maskPhone(phone || "unknown")}:`,
      sendErr.message
    );
    results.errors++;
  }
}
