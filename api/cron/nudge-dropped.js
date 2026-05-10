const { query, update } = require("../lib/supabase");
const { sendTemplate, maskPhone } = require("../lib/whatsapp");

const CRON_SECRET = process.env.CRON_SECRET;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * GET /api/cron/nudge-dropped
 * Cron: runs daily.
 * Sends a re-engagement "comeback_offer" template to dropped leads
 * that went silent 7–30 days ago, max once per lead.
 * Protected by CRON_SECRET.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Auth ──────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || "";
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    console.warn("[nudge-dropped] Unauthorized cron request");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const results = { sent: 0, skipped: 0, errors: 0 };

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();

    // ── Query eligible dropped leads ────────────────────────────────
    // status=dropped, last_msg_at between 7 and 30 days ago, nudge not yet sent
    // PostgREST range filter: and=(last_msg_at.gt.<30d>,last_msg_at.lt.<7d>)
    const leads = await query("leads", {
      select: "id, phone, name, last_msg_at",
      filters: {
        status: "eq.dropped",
        nudge_sent: "eq.false",
        and: `(last_msg_at.gt.${thirtyDaysAgo},last_msg_at.lt.${sevenDaysAgo})`,
      },
    });

    console.log(`[nudge-dropped] Found ${leads.length} eligible dropped leads`);

    for (const lead of leads) {
      const { id: leadId, phone, name } = lead;
      const maskedPhone = maskPhone(phone || "unknown");

      if (!phone) {
        console.log(`[nudge-dropped] Skipping lead=${leadId} — no phone number`);
        results.skipped++;
        continue;
      }

      // Respect rate limit: ensure at least 2hrs gap won't be violated
      // The whatsapp lib itself enforces this, but we handle the error gracefully
      try {
        await sendTemplate(phone, "comeback_offer", [
          name || "there",
        ]);

        console.log(
          `[nudge-dropped] Sent comeback_offer to ${maskedPhone} (lead=${leadId})`
        );

        // Mark nudge as sent so we don't re-send
        try {
          await update(
            "leads",
            { id: `eq.${leadId}` },
            { nudge_sent: true, nudge_sent_at: new Date().toISOString() }
          );
        } catch (updateErr) {
          console.error(
            `[nudge-dropped] Failed to update nudge_sent for lead=${leadId}:`,
            updateErr.message
          );
        }

        results.sent++;
      } catch (sendErr) {
        if (sendErr.message && sendErr.message.includes("Rate limited")) {
          console.log(
            `[nudge-dropped] Rate limited for ${maskedPhone} — skipping`
          );
          results.skipped++;
        } else {
          console.error(
            `[nudge-dropped] Failed to send to ${maskedPhone} (lead=${leadId}):`,
            sendErr.message
          );
          results.errors++;
        }
      }
    }

    console.log(
      `[nudge-dropped] Complete — sent=${results.sent} skipped=${results.skipped} errors=${results.errors}`
    );

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error("[nudge-dropped] Unhandled error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
