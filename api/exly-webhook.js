const { getSupabase } = require("./_lib/supabase");
const { sendWhatsApp } = require("./_lib/whatsapp");

/**
 * Map program slugs to their duration in days.
 */
const PROGRAM_DURATION_DAYS = {
  "6wk_gym": 42,
  "6wk_home": 42,
  "12wk": 84,
  pcos: 42,
  "40plus": 42,
  zoom_trial: 7,
  zoom_pack: 30,
};

/**
 * POST /api/exly-webhook
 *
 * Receives purchase-confirmation webhooks from the Exly payment platform,
 * converts the matching lead, creates a client record, sends onboarding
 * WhatsApp, and (for 12-week programs) kicks off program generation.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Verify webhook secret ──────────────────────────────────────────
  const secret = req.headers["x-webhook-secret"];
  if (!secret || secret !== process.env.EXLY_WEBHOOK_SECRET) {
    console.warn("[exly-webhook] Invalid or missing webhook secret");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { phone, name, email, program, amount, checkout_id, timestamp } =
    req.body || {};

  console.log(
    `[exly-webhook] Received purchase: phone=${phone}, program=${program}, checkout_id=${checkout_id}`
  );

  const supabase = getSupabase();

  try {
    // ── Look up existing lead ──────────────────────────────────────
    let leadId = null;

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (leadErr) {
      console.error("[exly-webhook] Error finding lead:", leadErr.message);
    }

    if (lead) {
      leadId = lead.id;

      // Mark lead as converted
      const { error: updateErr } = await supabase
        .from("leads")
        .update({ status: "converted" })
        .eq("id", leadId);

      if (updateErr) {
        console.error(
          "[exly-webhook] Error updating lead status:",
          updateErr.message
        );
      } else {
        console.log(`[exly-webhook] Lead ${leadId} marked as converted`);
      }
    } else {
      console.log(
        `[exly-webhook] No existing lead found for phone=${phone}, proceeding without lead_id`
      );
    }

    // ── Calculate program dates ────────────────────────────────────
    const now = new Date();
    const durationDays = PROGRAM_DURATION_DAYS[program] || 42; // default 42
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // ── Create client record ───────────────────────────────────────
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .insert({
        lead_id: leadId,
        phone,
        name,
        email,
        program,
        paid_amount: amount, // value in cents
        checkout_id,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        status: "active",
      })
      .select("id")
      .single();

    if (clientErr) {
      console.error(
        "[exly-webhook] Error creating client:",
        clientErr.message
      );
      return res.status(500).json({ error: "Failed to create client record" });
    }

    const clientId = client.id;

    // Set folder_url now that we have the client id
    const { error: folderErr } = await supabase
      .from("clients")
      .update({ folder_url: `/clients/${clientId}/` })
      .eq("id", clientId);

    if (folderErr) {
      console.error(
        "[exly-webhook] Error setting folder_url:",
        folderErr.message
      );
    }

    console.log(
      `[exly-webhook] Client created: id=${clientId}, program=${program}, ends=${endsAt.toISOString()}`
    );

    // ── Send onboarding WhatsApp ───────────────────────────────────
    try {
      await sendWhatsApp(phone, `onboard_${program}`, [name]);
      console.log(`[exly-webhook] Onboarding WhatsApp sent to ${phone}`);
    } catch (waErr) {
      console.error(
        "[exly-webhook] Failed to send onboarding WhatsApp:",
        waErr.message
      );
      // Non-fatal — continue
    }

    // ── Trigger program generation for 12-week programs ────────────
    if (program === "12wk") {
      try {
        const baseUrl =
          process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "http://localhost:3000";

        const genRes = await fetch(`${baseUrl}/api/generate-program`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });

        if (!genRes.ok) {
          console.error(
            `[exly-webhook] Program generation returned ${genRes.status}`
          );
        } else {
          console.log(
            `[exly-webhook] Program generation triggered for client ${clientId}`
          );
        }
      } catch (genErr) {
        console.error(
          "[exly-webhook] Failed to trigger program generation:",
          genErr.message
        );
        // Non-fatal — program can be generated later
      }
    }

    return res.status(200).json({ status: "converted", client_id: clientId });
  } catch (err) {
    console.error("[exly-webhook] Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
