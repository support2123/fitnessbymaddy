const { getSupabase } = require("./_lib/supabase");
const { sendTextMessage } = require("./_lib/whatsapp");
const { checkEscalation, notifyMaddy } = require("./_lib/escalation");

/**
 * POST /api/checkin-submit
 *
 * Handles weekly check-in form submissions from clients.
 * Upserts the check-in data, optionally triggers next-week program generation
 * for 12-week clients, sends a confirmation WhatsApp, and checks for
 * escalation keywords in the issues text.
 */
module.exports = async function handler(req, res) {
  // ── CORS headers ────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    client_id,
    week_no,
    weight,
    waist,
    compliance_score,
    energy,
    issues,
    photo_urls,
  } = req.body || {};

  // ── Validate required fields ──────────────────────────────────────
  if (!client_id || week_no == null) {
    return res
      .status(400)
      .json({ error: "Missing required fields: client_id, week_no" });
  }

  const supabase = getSupabase();

  try {
    // ── Verify client exists and is active ────────────────────────────
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, phone, program, status")
      .eq("id", client_id)
      .maybeSingle();

    if (clientErr) {
      console.error(
        "[checkin-submit] Error looking up client:",
        clientErr.message
      );
      return res.status(500).json({ error: "Failed to look up client" });
    }

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (client.status !== "active") {
      return res.status(404).json({ error: "Client is not active" });
    }

    // ── Upsert check-in (unique on client_id + week_no) ──────────────
    const { data: checkin, error: upsertErr } = await supabase
      .from("checkins")
      .upsert(
        {
          client_id,
          week_no: Number(week_no),
          form_submitted_at: new Date().toISOString(),
          weight: weight != null ? Number(weight) : null,
          waist: waist != null ? Number(waist) : null,
          compliance_score:
            compliance_score != null ? Math.round(Number(compliance_score)) : null,
          energy: energy != null ? Math.round(Number(energy)) : null,
          issues: issues || null,
          photos_urls: photo_urls || [],
        },
        { onConflict: "client_id,week_no" }
      )
      .select("id")
      .single();

    if (upsertErr) {
      console.error(
        "[checkin-submit] Error upserting check-in:",
        upsertErr.message
      );
      return res.status(500).json({ error: "Failed to save check-in" });
    }

    const checkinId = checkin.id;
    console.log(
      `[checkin-submit] Check-in saved: id=${checkinId}, client=${client_id}, week=${week_no}`
    );

    // ── Trigger program generation for 12-week clients ────────────────
    if (client.program === "12wk") {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:3000";

        const genRes = await fetch(`${baseUrl}/api/generate-program`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id,
            week_no: Number(week_no) + 1,
          }),
        });

        if (!genRes.ok) {
          console.error(
            `[checkin-submit] Program generation returned ${genRes.status}`
          );
        } else {
          console.log(
            `[checkin-submit] Program generation triggered for client ${client_id}, week ${Number(week_no) + 1}`
          );
        }
      } catch (genErr) {
        console.error(
          "[checkin-submit] Failed to trigger program generation:",
          genErr.message
        );
        // Non-fatal — program can be generated later
      }
    }

    // ── Send confirmation WhatsApp ────────────────────────────────────
    try {
      await sendTextMessage(
        client.phone,
        `Check-in received for Week ${week_no}! Your updated program will be ready within 24 hours. Keep pushing! 💪`
      );
      console.log(
        `[checkin-submit] Confirmation WhatsApp sent to client ${client_id}`
      );
    } catch (waErr) {
      console.error(
        "[checkin-submit] Failed to send confirmation WhatsApp:",
        waErr.message
      );
      // Non-fatal — continue
    }

    // ── Check for escalation in issues text ───────────────────────────
    if (issues) {
      const { shouldEscalate, reason } = checkEscalation(issues);

      if (shouldEscalate) {
        console.log(
          `[checkin-submit] Escalation triggered for client ${client_id}: "${reason}"`
        );
        try {
          await notifyMaddy(reason, {
            phone: client.phone,
            message: `Week ${week_no} check-in issue: ${issues}`,
          });
        } catch (escErr) {
          console.error(
            "[checkin-submit] Failed to send escalation:",
            escErr.message
          );
        }
      }
    }

    return res.status(200).json({ status: "submitted", checkin_id: checkinId });
  } catch (err) {
    console.error("[checkin-submit] Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
