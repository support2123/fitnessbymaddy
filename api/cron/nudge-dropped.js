const { getSupabase } = require("../_lib/supabase");
const { sendWhatsApp } = require("../_lib/whatsapp");

/**
 * Maximum number of nudge messages to send per dropped lead.
 */
const MAX_NUDGES = 2;

/**
 * GET /api/cron/nudge-dropped
 * Schedule: daily (vercel.json: "0 6 * * *")
 *
 * Re-engages leads that dropped within the last 7 days by sending
 * up to 2 nudge messages pushing the $20 trial link.
 */
module.exports = async function handler(req, res) {
  // ── Verify Vercel Cron auth ───────────────────────────────────────
  if (req.headers["authorization"] !== "Bearer " + process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabase();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  let nudged = 0;

  try {
    // ── Fetch dropped leads from the last 7 days ──────────────────────
    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select("id, phone, name")
      .eq("status", "dropped")
      .gte("created_at", sevenDaysAgo)
      .lt("last_msg_at", twentyFourHoursAgo);

    if (leadsErr) {
      console.error("[nudge-dropped] Error fetching dropped leads:", leadsErr.message);
      return res.status(500).json({ error: "Failed to fetch leads" });
    }

    if (!leads || leads.length === 0) {
      console.log("[nudge-dropped] No eligible dropped leads found");
      return res.status(200).json({ status: "done", nudged: 0 });
    }

    // ── Process each eligible lead ────────────────────────────────────
    for (const lead of leads) {
      try {
        // Count prior nudge messages sent to this phone
        const { count, error: countErr } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("phone", lead.phone)
          .eq("direction", "out")
          .ilike("template_name", "nudge%");

        if (countErr) {
          console.error(
            `[nudge-dropped] Error counting nudges for lead ${lead.id}:`,
            countErr.message
          );
          continue;
        }

        if ((count || 0) >= MAX_NUDGES) {
          console.log(
            `[nudge-dropped] Lead ${lead.id} already received ${count} nudges — skipping`
          );
          continue;
        }

        // Send the nudge template with trial link
        await sendWhatsApp(lead.phone, "nudge_trial", [
          lead.name || "there",
          "https://www.fitnessbymaddy.com/trial",
        ]);

        // Update last_msg_at so we don't message them again within 24h
        const { error: updateErr } = await supabase
          .from("leads")
          .update({ last_msg_at: now.toISOString() })
          .eq("id", lead.id);

        if (updateErr) {
          console.error(
            `[nudge-dropped] Error updating last_msg_at for lead ${lead.id}:`,
            updateErr.message
          );
        }

        console.log(`[nudge-dropped] Nudged lead ${lead.id} (phone ${lead.phone})`);
        nudged++;
      } catch (err) {
        console.error(
          `[nudge-dropped] Error processing lead ${lead.id}:`,
          err.message
        );
      }
    }

    console.log(`[nudge-dropped] Finished: nudged=${nudged}`);
    return res.status(200).json({ status: "done", nudged });
  } catch (err) {
    console.error("[nudge-dropped] Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
