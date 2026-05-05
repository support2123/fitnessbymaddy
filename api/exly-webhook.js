const crypto = require("crypto");
const { supabase } = require("./_lib/supabase");
const { sendTemplate, notifyMaddy } = require("./_lib/whatsapp");
const { respond, corsHeaders, maskPhone } = require("./_lib/helpers");

/* ── program duration map (days) ── */
const PROGRAM_DURATIONS = {
  "6wk_gym": 42,
  "6wk_home": 42,
  "12wk": 84,
  pcos: 42,
  "40plus": 42,
  zoom_trial: 7,
  zoom_pack: 30,
};

/* ── map Exly product name/slug to internal program key ── */
function mapProgram(productName) {
  const lower = (productName || "").toLowerCase();
  if (lower.includes("12") && lower.includes("week")) return "12wk";
  if (lower.includes("pcos")) return "pcos";
  if (lower.includes("40") || lower.includes("plus")) return "40plus";
  if (lower.includes("zoom") && lower.includes("trial")) return "zoom_trial";
  if (lower.includes("zoom") && lower.includes("pack")) return "zoom_pack";
  if (lower.includes("home")) return "6wk_home";
  // default 6-week gym
  return "6wk_gym";
}

/* ── verify Exly HMAC-SHA256 signature ── */
function verifySignature(rawBody, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature || "", "hex")
  );
}

/* ── send confirmation email via Resend ── */
async function sendConfirmationEmail(email, name, program) {
  try {
    const { Resend } = require("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "FitnessByMaddy <hello@fitnessbymaddy.com>",
      to: email,
      subject: `Welcome to FitnessByMaddy - ${program} program!`,
      html: `<p>Hi ${name},</p>
<p>Thank you for purchasing the <strong>${program}</strong> program! We're excited to have you on board.</p>
<p>You'll receive your first program details on WhatsApp shortly. If you have any questions, just reply to this email.</p>
<p>Let's crush it!<br/>Team FitnessByMaddy</p>`,
    });
  } catch (err) {
    console.error("Resend email failed:", err.message);
  }
}

module.exports = async function handler(req, res) {
  /* CORS preflight */
  if (req.method === "OPTIONS") {
    const headers = corsHeaders();
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return respond(res, 405, { error: "Method not allowed" });
  }

  try {
    /* ── 1. Read raw body & verify signature ── */
    const rawBody = await new Promise((resolve, reject) => {
      if (typeof req.body === "string") {
        resolve(req.body);
        return;
      }
      if (req.body && typeof req.body === "object") {
        resolve(JSON.stringify(req.body));
        return;
      }
      let buf = "";
      req.on("data", (chunk) => { buf += chunk; });
      req.on("end", () => resolve(buf));
      req.on("error", reject);
    });

    const signature =
      req.headers["x-exly-signature"] ||
      req.headers["x-webhook-signature"] ||
      "";

    if (!verifySignature(rawBody, signature)) {
      console.warn("Exly webhook: invalid signature");
      return respond(res, 401, { error: "Invalid signature" });
    }

    const body = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;

    /* ── 2. Extract fields ── */
    const phone = body.customer_phone || body.phone;
    const email = body.customer_email || body.email;
    const name = body.customer_name || body.name || "Client";
    const checkoutId = body.checkout_id || body.order_id;
    const amount = body.amount || body.paid_amount || 0;
    const productName =
      body.product_name || body.program_name || body.product || "";

    if (!phone) {
      return respond(res, 400, { error: "Missing customer phone" });
    }

    const program = mapProgram(productName);
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    console.log(
      `Exly webhook: ${maskPhone(phone)} purchased ${program} (${productName})`
    );

    /* ── 3. Find matching lead ── */
    const { data: lead } = await supabase
      .from("leads")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    /* ── 4. Update lead status ── */
    if (lead) {
      await supabase
        .from("leads")
        .update({ status: "converted" })
        .eq("id", lead.id);
    }

    /* ── 5. Insert client ── */
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error: insertErr } = await supabase
      .from("clients")
      .insert({
        lead_id: lead ? lead.id : null,
        phone,
        name,
        email: email || null,
        program,
        paid_amount: amount,
        checkout_id: checkoutId,
        status: "active",
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("Client insert failed:", insertErr.message);
      return respond(res, 500, { error: "Failed to create client record" });
    }

    const clientId = client.id;

    /* ── 6. Ensure storage folder path exists (upload a placeholder) ── */
    await supabase.storage
      .from("clients")
      .upload(
        `${clientId}/.keep`,
        new Uint8Array(0),
        { contentType: "application/octet-stream", upsert: true }
      );

    /* ── 7. Send welcome WhatsApp template ── */
    await sendTemplate(
      phone,
      `onboard_${program}`,
      [name],
      { isClient: true }
    );

    /* ── 8. For 12-week program, trigger generate-program ── */
    if (program === "12wk") {
      // Fire-and-forget internal call to generate initial program
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
      fetch(`${baseUrl}/api/generate-program`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, week_no: 1 }),
      }).catch((err) =>
        console.error("generate-program trigger failed:", err.message)
      );
    }

    /* ── 9. Send confirmation email ── */
    if (email) {
      await sendConfirmationEmail(email, name, program);
    }

    /* ── 10. Notify Maddy ── */
    await notifyMaddy(
      `New client converted!\nName: ${name}\nPhone: ${maskPhone(phone)}\nProgram: ${program}\nAmount: ${amount}`
    );

    return respond(res, 200, {
      ok: true,
      client_id: clientId,
      program,
    });
  } catch (err) {
    console.error("Exly webhook error:", err);
    return respond(res, 500, { error: "Internal server error" });
  }
};
