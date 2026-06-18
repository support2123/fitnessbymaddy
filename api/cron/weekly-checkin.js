const { getSupabase } = require("../_lib/supabase");
const { sendWhatsApp } = require("../_lib/whatsapp");

/**
 * Weekly check-in cron — runs every Sunday at 9 AM IST (03:30 UTC).
 *
 * For each active client:
 *  - Calculates their current week number from program_started_at
 *  - Marks completed clients and sends a completion message
 *  - Sends a check-in form link if one hasn't been sent this week
 */
module.exports = async (req, res) => {
  // ── Auth ────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const supabase = getSupabase();
  let processed = 0;
  let skipped = 0;

  try {
    // ── Fetch all active clients ────────────────────────────────────
    const { data: clients, error: clientErr } = await supabase
      .from("clients")
      .select("id, name, phone, program_started_at, program_ends_at")
      .eq("status", "active");

    if (clientErr) {
      console.error("[weekly-checkin] Failed to fetch clients:", clientErr.message);
      return res.status(500).json({ error: "Failed to fetch clients" });
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({ processed: 0, skipped: 0, message: "No active clients" });
    }

    const now = new Date();

    for (const client of clients) {
      try {
        const startedAt = new Date(client.program_started_at);
        const endsAt = client.program_ends_at ? new Date(client.program_ends_at) : null;

        // ── Calculate current week number (1-indexed) ───────────────
        const msPerWeek = 7 * 24 * 60 * 60 * 1000;
        const weekNo = Math.floor((now - startedAt) / msPerWeek) + 1;

        // ── Program completed? ──────────────────────────────────────
        if (endsAt && now > endsAt) {
          const { error: updateErr } = await supabase
            .from("clients")
            .update({ status: "completed" })
            .eq("id", client.id);

          if (updateErr) {
            console.error(`[weekly-checkin] Failed to mark client ${client.id} completed:`, updateErr.message);
          }

          try {
            await sendWhatsApp(client.phone, "program_completed", [
              client.name || "there",
            ]);
          } catch (whatsappErr) {
            console.error(`[weekly-checkin] Failed to send completion msg to client ${client.id}:`, whatsappErr.message);
          }

          processed++;
          continue;
        }

        // ── Already checked in this week? ───────────────────────────
        const { data: existing, error: checkinErr } = await supabase
          .from("checkins")
          .select("id")
          .eq("client_id", client.id)
          .eq("week_no", weekNo)
          .limit(1);

        if (checkinErr) {
          console.error(`[weekly-checkin] Checkin lookup failed for client ${client.id}:`, checkinErr.message);
          skipped++;
          continue;
        }

        if (existing && existing.length > 0) {
          skipped++;
          continue;
        }

        // ── Send check-in form link ─────────────────────────────────
        const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const message = `Hey ${client.name || "there"}! Time for your Week ${weekNo} check-in! Fill it out here: ${formUrl}`;

        try {
          await sendWhatsApp(client.phone, "weekly_checkin", [
            client.name || "there",
            String(weekNo),
            formUrl,
          ]);
        } catch (whatsappErr) {
          console.error(`[weekly-checkin] Failed to send checkin to client ${client.id}:`, whatsappErr.message);
          skipped++;
          continue;
        }

        processed++;
      } catch (clientLoopErr) {
        console.error(`[weekly-checkin] Error processing client ${client.id}:`, clientLoopErr.message);
        skipped++;
      }
    }

    console.log(`[weekly-checkin] Done — processed: ${processed}, skipped: ${skipped}`);
    return res.status(200).json({ processed, skipped });
  } catch (err) {
    console.error("[weekly-checkin] Unhandled error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
