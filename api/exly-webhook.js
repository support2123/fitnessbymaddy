const { query, insert, update } = require("./lib/supabase");
const { sendTemplate, maskPhone } = require("./lib/whatsapp");
const { jsonResponse, errorResponse, mapProductToProgram } = require("./lib/utils");

/**
 * Calculate program end date based on program type.
 */
function calculateProgramEnd(program) {
  const now = new Date();
  const weeks = (program && program.duration_weeks) || 12;
  now.setDate(now.getDate() + weeks * 7);
  return now.toISOString();
}

/**
 * Trigger internal program generation for 12-week programs.
 */
async function triggerProgramGeneration(clientId, programSlug) {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.BASE_URL || "http://localhost:3000";

    const resp = await fetch(`${baseUrl}/api/generate-program`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
      },
      body: JSON.stringify({ client_id: clientId, program: programSlug }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[exly-webhook] Program generation trigger failed (${resp.status}): ${body}`);
    }
  } catch (err) {
    console.error(`[exly-webhook] Program generation trigger error: ${err.message}`);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return errorResponse(res, "Method not allowed", 405);
  }

  // ---------- Verify webhook secret ----------
  const webhookSecret = req.headers["x-exly-webhook-secret"]
    || req.headers["x-webhook-secret"]
    || req.headers["authorization"];

  if (!process.env.EXLY_WEBHOOK_SECRET || webhookSecret !== process.env.EXLY_WEBHOOK_SECRET) {
    console.error("[exly-webhook] Invalid or missing webhook secret");
    return errorResponse(res, "Unauthorized", 401);
  }

  let phone;

  try {
    const body = req.body || {};

    phone = body.phone || body.mobile || body.customer_phone;
    const name = body.name || body.customer_name || null;
    const email = body.email || body.customer_email || null;
    const amount = body.amount || body.total_amount || 0;
    const checkoutId = body.checkout_id || body.order_id || body.transaction_id || null;
    const productName = body.product_name || body.item_name || body.product || null;

    if (!phone) {
      return errorResponse(res, "Missing phone number in webhook payload", 400);
    }

    // Normalize phone
    if (!phone.startsWith("+")) {
      phone = `+${phone}`;
    }

    // ---------- Map product to program ----------
    const program = mapProductToProgram(productName);
    const programSlug = program ? program.slug : "unknown";

    console.log(`[exly-webhook] Purchase received: ${maskPhone(phone)}, product="${productName}", program=${programSlug}`);

    // ---------- Find and update lead ----------
    const leads = await query("leads", {
      filters: { phone: `eq.${phone}` },
      limit: 1,
    });

    if (leads && leads.length > 0) {
      await update("leads", { phone: `eq.${phone}` }, {
        status: "converted",
        program_interest: programSlug,
        converted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } else {
      // Lead not found -- create one retroactively as converted
      await insert("leads", {
        phone,
        name,
        status: "converted",
        program_interest: programSlug,
        source: "exly_direct",
        converted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
    }

    // ---------- Insert into clients table ----------
    const programEndsAt = calculateProgramEnd(program);
    const [client] = await insert("clients", {
      lead_id: leads && leads.length > 0 ? leads[0].id : null,
      phone,
      name,
      email,
      program: programSlug,
      paid_amount: Number(amount),
      checkout_id: checkoutId,
      status: "active",
      program_started_at: new Date().toISOString(),
      program_ends_at: programEndsAt,
      created_at: new Date().toISOString(),
    });

    // ---------- Send onboarding WhatsApp ----------
    const templateName = `onboard_${programSlug}`;
    try {
      await sendTemplate(phone, templateName, [name || "there"]);
      console.log(`[exly-webhook] Onboarding template '${templateName}' sent to ${maskPhone(phone)}`);
    } catch (sendErr) {
      console.error(`[exly-webhook] Onboarding send failed for ${maskPhone(phone)}: ${sendErr.message}`);
    }

    // ---------- Log the conversion ----------
    try {
      await insert("messages", {
        phone,
        direction: "out",
        template_name: templateName,
        body: null,
        created_at: new Date().toISOString(),
      });
    } catch (logErr) {
      console.error(`[exly-webhook] Message log failed: ${logErr.message}`);
    }

    // ---------- Trigger program generation for 12-week programs ----------
    if (program && program.duration_weeks === 12 && client) {
      // Fire and forget -- don't block the webhook response
      triggerProgramGeneration(client.id, programSlug);
    }

    return jsonResponse(res, {
      status: "converted",
      client_id: client ? client.id : null,
      program: programSlug,
    });

  } catch (err) {
    const safePhone = phone ? maskPhone(phone) : "unknown";
    console.error(`[exly-webhook] Error for ${safePhone}: ${err.message}`);
    return errorResponse(res, "Internal server error", 500);
  }
}
