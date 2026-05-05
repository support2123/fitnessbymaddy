const { supabase } = require("../_lib/supabase");
const { sendTemplate } = require("../_lib/whatsapp");
const { respond, maskPhone } = require("../_lib/helpers");

/* ── Helpers ──────────────────────────────────────────────────────── */

async function logMessage(phone, direction, body) {
  const { error } = await supabase
    .from("messages")
    .insert({ phone, direction, body, sent_at: new Date().toISOString() });

  if (error) console.error("logMessage error:", error.message);
}

function weekNumber(programStartedAt) {
  const start = new Date(programStartedAt).getTime();
  const now = Date.now();
  return Math.ceil((now - start) / (7 * 24 * 60 * 60 * 1000));
}

/* ── Main handler ─────────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  // Vercel cron triggers with GET
  if (req.method !== "GET") {
    return respond(res, 405, { error: "Method not allowed" });
  }

  // Verify cron secret
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return respond(res, 401, { error: "Unauthorized" });
  }

  const summary = { notified: 0, skipped: 0, errors: 0 };

  try {
    // Fetch all active clients whose program hasn't ended
    const now = new Date().toISOString();
    const { data: clients, error: fetchErr } = await supabase
      .from("clients")
      .select("*")
      .eq("status", "active")
      .gt("program_ends_at", now);

    if (fetchErr) {
      console.error("Failed to fetch active clients:", fetchErr.message);
      return respond(res, 500, { error: "Failed to fetch clients" });
    }

    if (!clients || clients.length === 0) {
      return respond(res, 200, { status: "ok", ...summary, detail: "no_active_clients" });
    }

    for (const client of clients) {
      try {
        const weekNo = weekNumber(client.program_started_at);

        // Check if checkin already exists for this client + week
        const { data: existing, error: checkErr } = await supabase
          .from("checkins")
          .select("id")
          .eq("client_id", client.id)
          .eq("week_no", weekNo)
          .maybeSingle();

        if (checkErr) {
          console.error(`Checkin lookup error for ${maskPhone(client.phone)}:`, checkErr.message);
          summary.errors++;
          continue;
        }

        if (existing) {
          summary.skipped++;
          continue;
        }

        // Build check-in link
        const checkinUrl =
          `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        // Send WhatsApp template
        const result = await sendTemplate(
          client.phone,
          "weekly_checkin",
          [client.name || "there", String(weekNo), checkinUrl],
          { isClient: true }
        );

        if (result.skipped) {
          console.log(`Rate-limited for ${maskPhone(client.phone)}, skipping`);
          summary.skipped++;
          continue;
        }

        if (!result.ok) {
          console.error(`Template send failed for ${maskPhone(client.phone)}:`, result.error);
          summary.errors++;
          continue;
        }

        // Log the outbound message
        await logMessage(
          client.phone,
          "out",
          `[template: weekly_checkin] Week ${weekNo} check-in form sent: ${checkinUrl}`
        );

        summary.notified++;
      } catch (err) {
        console.error(`Error processing client ${maskPhone(client.phone)}:`, err.message);
        summary.errors++;
      }
    }

    // Note: clients who don't submit their checkin within 24-72h
    // will be picked up by the nudge-dropped cron job automatically.

    return respond(res, 200, { status: "ok", ...summary });
  } catch (err) {
    console.error("weekly-checkin cron error:", err);
    return respond(res, 500, { error: err.message, ...summary });
  }
};
