const { supabase } = require("../lib/supabase");
const { sendWhatsApp } = require("../lib/whatsapp");
const { maskPhone } = require("../lib/utils");

const EXLY_WEBHOOK_SECRET = process.env.EXLY_WEBHOOK_SECRET;

/**
 * Map Exly product names to internal program keys and durations.
 */
const PRODUCT_TO_PROGRAM = {
  "6-week gym shred": { program: "6wk_gym", weeks: 6 },
  "6 week gym shred": { program: "6wk_gym", weeks: 6 },
  "6-week home program": { program: "6wk_home", weeks: 6 },
  "6 week home program": { program: "6wk_home", weeks: 6 },
  "pcos program": { program: "pcos", weeks: 6 },
  "fit after 40": { program: "40plus", weeks: 6 },
  "12-week custom coaching": { program: "12wk", weeks: 12 },
  "12 week custom coaching": { program: "12wk", weeks: 12 },
  "zoom trial session": { program: "zoom_trial", weeks: 1 },
};

function mapProduct(productName) {
  if (!productName) return { program: "unknown", weeks: 6 };
  const lower = productName.toLowerCase().trim();
  return PRODUCT_TO_PROGRAM[lower] || { program: "unknown", weeks: 6 };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ── Verify webhook secret ─────────────────────────────────────
    if (EXLY_WEBHOOK_SECRET) {
      const signature =
        req.headers["x-exly-signature"] ||
        req.headers["x-webhook-secret"] ||
        req.body?.secret;

      if (signature !== EXLY_WEBHOOK_SECRET) {
        console.error("[exly-webhook] Invalid webhook secret");
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const body = req.body || {};
    const buyerPhone = body.phone || body.mobile || body.buyer_phone;
    const buyerEmail = body.email || body.buyer_email;
    const buyerName = body.name || body.buyer_name || "";
    const productName = body.product || body.plan || body.product_name || "";
    const amount = body.amount || body.paid_amount || 0;
    const checkoutId =
      body.checkout_id || body.transaction_id || body.order_id || null;

    if (!buyerPhone) {
      return res.status(400).json({ error: "Missing buyer phone" });
    }

    // ── Map product to program ────────────────────────────────────
    const { program, weeks } = mapProduct(productName);

    const now = new Date();
    const programEndsAt = new Date(now);
    programEndsAt.setDate(programEndsAt.getDate() + weeks * 7);

    // ── Find matching lead ────────────────────────────────────────
    const { data: lead } = await supabase
      .from("leads")
      .select("id")
      .eq("phone", buyerPhone)
      .single();

    const leadId = lead ? lead.id : null;

    // ── Insert client record ──────────────────────────────────────
    const { data: client, error: insertError } = await supabase
      .from("clients")
      .insert({
        lead_id: leadId,
        phone: buyerPhone,
        name: buyerName || null,
        email: buyerEmail || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: programEndsAt.toISOString(),
        paid_amount: amount,
        checkout_id: checkoutId,
        status: "active",
      })
      .select()
      .single();

    if (insertError) {
      console.error(
        `[exly-webhook] Failed to insert client for ${maskPhone(buyerPhone)}: ${insertError.message}`
      );
      return res.status(500).json({ error: "Failed to create client record" });
    }

    // ── Update lead status to converted ───────────────────────────
    if (leadId) {
      await supabase
        .from("leads")
        .update({ status: "converted" })
        .eq("id", leadId);
    }

    // ── Send onboarding WhatsApp template ─────────────────────────
    await sendWhatsApp(buyerPhone, "onboard_welcome", {
      name: buyerName || "there",
      templateParams: [buyerName || "there", productName || program],
    });

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error(`[exly-webhook] Unhandled error: ${err.message}`);
    return res.status(500).json({ error: "Internal server error" });
  }
};
