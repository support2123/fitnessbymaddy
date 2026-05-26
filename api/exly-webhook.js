const { supabase } = require("./_lib/supabase");
const { sendTemplate } = require("./_lib/whatsapp");
const { Resend } = require("resend");

const EXLY_WEBHOOK_SECRET = process.env.EXLY_WEBHOOK_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = "support@fitnessbymaddy.com";
const GENERATE_PROGRAM_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}/api/generate-program`
  : "http://localhost:3000/api/generate-program";

// Program duration in days by slug
const PROGRAM_DURATIONS = {
  "6wk-shred": 42,
  "6wk": 42,
  pcos: 42,
  "40plus": 42,
  "12wk-flagship": 84,
  "12wk": 84,
  "zoom-trial": 1,
  trial: 1,
};

/** Mask phone for safe logging. */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, -4).replace(/.(?=.{2})/g, "*").slice(0, -2) + phone.slice(-4, -2) + "**";
}

/** Normalise program key from Exly checkout metadata. */
function normaliseProgram(raw) {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (lower.includes("12") || lower.includes("flagship")) return "12wk";
  if (lower.includes("pcos")) return "pcos";
  if (lower.includes("40") || lower.includes("plus")) return "40plus";
  if (lower.includes("zoom") || lower.includes("trial")) return "trial";
  if (lower.includes("6") || lower.includes("shred")) return "6wk";
  return "unknown";
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, note: "ignored non-POST" });
  }

  try {
    // Validate webhook secret if configured
    if (EXLY_WEBHOOK_SECRET) {
      const headerSecret =
        req.headers["x-exly-secret"] ||
        req.headers["x-webhook-secret"] ||
        "";
      if (headerSecret !== EXLY_WEBHOOK_SECRET) {
        console.warn("[exly] Invalid webhook secret");
        return res.status(200).json({ ok: false, error: "invalid secret" });
      }
    }

    const payload = req.body || {};

    const phone = payload.phone || payload.customer_phone || "";
    const name = payload.name || payload.customer_name || "";
    const email = payload.email || payload.customer_email || "";
    const amount = payload.amount || payload.total || 0;
    const checkoutId = payload.checkout_id || payload.order_id || "";
    const programRaw = payload.program || payload.product || payload.plan || "";

    if (!phone) {
      console.warn("[exly] No phone in payload");
      return res.status(200).json({ ok: true, note: "no phone" });
    }

    const programKey = normaliseProgram(programRaw);
    const durationDays = PROGRAM_DURATIONS[programKey] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Find existing lead
    const { data: lead } = await supabase
      .from("leads")
      .select("id, market")
      .eq("phone", phone)
      .maybeSingle();

    if (lead) {
      await supabase
        .from("leads")
        .update({ status: "converted", updated_at: new Date().toISOString() })
        .eq("id", lead.id);
    }

    // Create client record
    const { data: newClient, error: clientErr } = await supabase
      .from("clients")
      .insert({
        phone,
        name: name || null,
        email: email || null,
        status: "active",
        program: programKey,
        amount: Number(amount) || 0,
        checkout_id: checkoutId || null,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        market: lead?.market || null,
        lead_id: lead?.id || null,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (clientErr) {
      console.error(`[exly] Client insert failed for ${maskPhone(phone)}:`, clientErr.message);
      return res.status(200).json({ ok: false, error: "client insert failed" });
    }

    console.log(`[exly] New client ${maskPhone(phone)}, program=${programKey}, id=${newClient?.id}`);

    // Send onboarding WhatsApp template
    try {
      const templateName = `onboard_${programKey}`;
      await sendTemplate(phone, templateName, {
        name: name || "there",
        templateParams: [name || "there"],
      });
    } catch (tmplErr) {
      console.error(`[exly] Onboarding template failed for ${maskPhone(phone)}:`, tmplErr.message);
    }

    // Send welcome email via Resend
    if (email && RESEND_API_KEY) {
      try {
        const resend = new Resend(RESEND_API_KEY);
        await resend.emails.send({
          from: FROM_EMAIL,
          to: email,
          subject: `Welcome to Fitness by Maddy — ${programRaw || programKey}!`,
          html: [
            `<h2>Hey ${name || "there"}!</h2>`,
            `<p>Welcome to the <strong>${programRaw || programKey}</strong> program. I'm so excited to have you on board!</p>`,
            `<p>Your program starts <strong>today</strong> and runs for <strong>${durationDays} days</strong>.</p>`,
            `<p>You'll hear from me on WhatsApp with your plan details, check-ins, and support. Keep an eye on your messages!</p>`,
            `<p>If you have any questions, just reply to this email or message me on WhatsApp.</p>`,
            `<br>`,
            `<p>Let's go!</p>`,
            `<p><strong>Maddy</strong><br>Fitness by Maddy</p>`,
          ].join("\n"),
        });
      } catch (emailErr) {
        console.error(`[exly] Welcome email failed for ${maskPhone(phone)}:`, emailErr.message);
      }
    }

    // If 12-week program, trigger program generation
    if (programKey === "12wk" && newClient?.id) {
      try {
        fetch(GENERATE_PROGRAM_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: newClient.id,
            phone,
            name,
            program: programKey,
          }),
        }).catch((fetchErr) => {
          // Fire-and-forget — don't block the webhook response
          console.error(`[exly] Program generation trigger failed:`, fetchErr.message);
        });
      } catch (triggerErr) {
        console.error(`[exly] Program generation trigger error:`, triggerErr.message);
      }
    }

    return res.status(200).json({ ok: true, action: "client-created" });
  } catch (err) {
    console.error("[exly] Unhandled error:", err.message);
    return res.status(200).json({ ok: true, error: "internal" });
  }
};
