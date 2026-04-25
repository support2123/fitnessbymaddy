const { getSupabase } = require("../../lib/supabase");
const { sendTemplate } = require("../../lib/whatsapp");

const CHECKIN_BASE_URL = "https://fitnessbymaddy.com/checkin.html";

/* ---------- helpers ---------- */

function getProgramLength(programName) {
  const name = (programName || "").toLowerCase();
  if (name.includes("12") || name.includes("twelve") || name.includes("flagship")) return 12;
  if (name.includes("6") || name.includes("six") || name.includes("burn") || name.includes("shred")) return 6;
  return 12; // default
}

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

    // Check Vercel's built-in cron auth or CRON_SECRET
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabase = getSupabase();
    const now = new Date();

    /* ---- fetch all active clients ---- */
    const { data: clients, error: clientsErr } = await supabase
      .from("clients")
      .select("*")
      .eq("status", "active");

    if (clientsErr) {
      console.error("Failed to fetch clients:", clientsErr.message);
      return res.status(200).json({ error: "Failed to fetch clients" });
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({ sent: 0, skipped: 0, completed: 0 });
    }

    let sent = 0;
    let skipped = 0;
    let completed = 0;

    for (const client of clients) {
      try {
        /* ---- calculate current week number ---- */
        const programStart = new Date(client.program_started_at);
        const msElapsed = now.getTime() - programStart.getTime();
        const weeksElapsed = Math.floor(msElapsed / (7 * 24 * 60 * 60 * 1000));
        const currentWeek = weeksElapsed + 1;

        const programLength = getProgramLength(client.program);

        /* ---- check if program is complete ---- */
        if (currentWeek > programLength) {
          await supabase
            .from("clients")
            .update({ status: "completed" })
            .eq("id", client.id);

          completed++;
          continue;
        }

        /* ---- check if check-in already submitted for this week ---- */
        const { data: existingCheckin } = await supabase
          .from("checkins")
          .select("id")
          .eq("client_id", client.id)
          .eq("week_no", currentWeek)
          .limit(1);

        if (existingCheckin && existingCheckin.length > 0) {
          skipped++;
          continue;
        }

        /* ---- send WhatsApp with check-in form link ---- */
        if (!client.phone) {
          skipped++;
          continue;
        }

        const checkinUrl = `${CHECKIN_BASE_URL}?c=${client.id}&w=${currentWeek}`;

        await sendTemplate(client.phone, "weekly_checkin", [
          client.name || "there",
          String(currentWeek),
          checkinUrl,
        ]);

        // Log the message sent (sendTemplate already logs internally via whatsapp.js)
        console.log(
          `Sent weekly_checkin to client=${client.id}, week=${currentWeek}`
        );

        sent++;
      } catch (clientErr) {
        console.error(
          `Error processing client ${client.id}:`,
          maskPII(clientErr.message)
        );
        skipped++;
      }
    }

    return res.status(200).json({ sent, skipped, completed });
  } catch (err) {
    console.error("weekly-checkin cron error:", maskPII(err.message));
    // Return 200 for crons even on internal errors
    return res.status(200).json({ error: "Internal error" });
  }
};
