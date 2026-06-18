const { getSupabase } = require("./_lib/supabase");
const { sendWhatsApp } = require("./_lib/whatsapp");
const { sendEmail } = require("./_lib/email");
const { detectMarket } = require("./_lib/market");

// ---- Program duration map (in days) ----
const PROGRAM_DURATIONS = {
  "6wk_gym": 42,
  "6wk_home": 42,
  pcos: 42,
  "40plus": 42,
  "12wk": 84,
  zoom_trial: 7,
  zoom_pack: 30,
};

// ---- Map product name to program enum via keyword matching ----
function mapProductToProgram(productName) {
  if (!productName) return "6wk_gym"; // default fallback

  const lower = productName.toLowerCase();

  if (lower.includes("12") && (lower.includes("week") || lower.includes("wk")))
    return "12wk";
  if (lower.includes("pcos") || lower.includes("hormonal")) return "pcos";
  if (lower.includes("40") || lower.includes("plus") || lower.includes("menopause"))
    return "40plus";
  if (lower.includes("zoom") && lower.includes("trial")) return "zoom_trial";
  if (lower.includes("zoom") && (lower.includes("pack") || lower.includes("monthly")))
    return "zoom_pack";
  if (lower.includes("home") || lower.includes("bodyweight")) return "6wk_home";
  // Default to 6wk_gym for generic fitness / fat-loss / gym plans
  return "6wk_gym";
}

// ---- Welcome email HTML ----
function buildWelcomeEmail(name, program) {
  const programLabels = {
    "6wk_gym": "6-Week Gym Transformation",
    "6wk_home": "6-Week Home Workout Plan",
    pcos: "PCOS/Hormonal Program",
    "40plus": "40+ Fitness Program",
    "12wk": "12-Week Custom Program",
    zoom_trial: "Zoom Training Trial",
    zoom_pack: "Zoom Training Pack",
  };

  const label = programLabels[program] || program;

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #e53e3e;">Welcome to Fitness by Maddy!</h1>
      <p>Hi ${name || "there"},</p>
      <p>Thank you for joining the <strong>${label}</strong>! We're thrilled to have you on board.</p>
      <p>Here's what happens next:</p>
      <ol>
        <li>You'll receive your personalised plan on WhatsApp within 24 hours</li>
        <li>Complete your intake form if you haven't already</li>
        <li>Weekly check-ins will keep you on track</li>
      </ol>
      <p>If you have any questions, just reply to this email or message us on WhatsApp.</p>
      <p>Let's crush it!</p>
      <p><strong>- Maddy & Team</strong></p>
    </div>
  `;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ---- Verify webhook secret ----
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret && req.headers["x-webhook-secret"] !== secret) {
    console.warn("[exly] Invalid webhook secret");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = req.body || {};
    const phone = body.phone || body.buyer_phone;
    const name = body.name || body.buyer_name;
    const email = body.email || body.buyer_email;
    const productName = body.product_name || body.product;
    const amount = body.amount || body.price;
    const checkoutId = body.checkout_id || body.order_id;

    if (!phone) {
      console.warn("[exly] Webhook missing phone");
      return res.status(400).json({ error: "Missing buyer phone" });
    }

    const supabase = getSupabase();
    const program = mapProductToProgram(productName);
    const market = detectMarket(phone);
    const now = new Date().toISOString();

    // ---- Find or create lead, set status=converted ----
    let leadId;
    const { data: existingLead } = await supabase
      .from("leads")
      .select("id")
      .eq("phone", phone)
      .limit(1)
      .single();

    if (existingLead) {
      leadId = existingLead.id;
      await supabase
        .from("leads")
        .update({
          status: "converted",
          name: name || undefined,
          program_interest: program,
          last_msg_at: now,
        })
        .eq("id", leadId);
    } else {
      const { data: newLead, error: createErr } = await supabase
        .from("leads")
        .insert({
          phone,
          name: name || null,
          status: "converted",
          source: "exly",
          market,
          program_interest: program,
          last_msg_at: now,
          created_at: now,
        })
        .select()
        .single();

      if (createErr) {
        console.error("[exly] Failed to create lead:", createErr.message);
        return res.status(500).json({ error: "Failed to create lead" });
      }

      leadId = newLead.id;
    }

    // ---- Calculate program end date ----
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // ---- Insert into clients table ----
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .insert({
        lead_id: leadId,
        phone,
        name: name || null,
        email: email || null,
        program,
        paid_amount: amount || null,
        checkout_id: checkoutId || null,
        status: "active",
        program_started_at: startsAt.toISOString(),
        program_ends_at: endsAt.toISOString(),
        created_at: now,
      })
      .select()
      .single();

    if (clientErr) {
      console.error("[exly] Failed to create client:", clientErr.message);
      return res.status(500).json({ error: "Failed to create client" });
    }

    // ---- Send onboarding WhatsApp template ----
    try {
      await sendWhatsApp(phone, `onboard_${program}`, [name || "there"]);
    } catch (err) {
      console.error("[exly] WhatsApp onboarding failed:", err.message);
    }

    // ---- Send welcome email via Resend ----
    if (email) {
      try {
        await sendEmail(
          email,
          "Welcome to Fitness by Maddy!",
          buildWelcomeEmail(name, program)
        );
      } catch (err) {
        console.error("[exly] Welcome email failed:", err.message);
      }
    }

    console.log(
      `[exly] Client created: ${client.id} | program: ${program} | ends: ${endsAt.toISOString()}`
    );

    return res.status(200).json({ ok: true, clientId: client.id, program });
  } catch (err) {
    console.error("[exly] Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
