const supabase = require("../lib/supabase");
const { sendTemplate } = require("../lib/whatsapp");
const { maskPhone, programDuration } = require("../lib/helpers");

// Map Exly product names to internal program enums
const PRODUCT_MAP = [
  { keywords: ["6 week gym", "6-week gym", "6wk gym", "gym shred"], program: "6wk_gym" },
  { keywords: ["6 week home", "6-week home", "6wk home", "home shred"], program: "6wk_home" },
  { keywords: ["12 week", "12-week", "12wk", "custom coaching"], program: "12wk" },
  { keywords: ["pcos", "hormonal reset"], program: "pcos" },
  { keywords: ["40+", "40 plus", "40plus", "strong"], program: "40plus" },
  { keywords: ["zoom trial", "trial session"], program: "zoom_trial" },
  { keywords: ["zoom pack", "zoom 4", "4 pack"], program: "zoom_pack" },
];

function mapProduct(productName) {
  const lower = (productName || "").toLowerCase();
  for (const { keywords, program } of PRODUCT_MAP) {
    if (keywords.some((kw) => lower.includes(kw))) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // --- Verify webhook secret ---
    const secret = req.headers["x-webhook-secret"];
    if (!secret || secret !== process.env.EXLY_WEBHOOK_SECRET) {
      console.warn("[exly-webhook] Invalid webhook secret");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { phone, name, email, amount, checkout_id, product_name } =
      req.body || {};

    if (!phone || !product_name) {
      return res
        .status(400)
        .json({ error: "Missing required fields: phone, product_name" });
    }

    const masked = maskPhone(phone);
    console.log(`[exly-webhook] Purchase from ${masked}: ${product_name}`);

    // --- Map product to program ---
    const program = mapProduct(product_name);
    if (!program) {
      console.error(`[exly-webhook] Unknown product: ${product_name}`);
      return res.status(400).json({ error: "Unknown product" });
    }

    // --- Find or create lead, set status=converted ---
    const { data: lead } = await supabase
      .from("leads")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    let leadId = lead?.id;

    if (!leadId) {
      // Lead didn't come through WhatsApp first — create one
      const { data: newLead, error: leadErr } = await supabase
        .from("leads")
        .insert({
          phone,
          name: name || null,
          status: "converted",
          source: "exly",
          program_interest: program,
        })
        .select("id")
        .single();

      if (leadErr) {
        console.error(`[exly-webhook] Lead insert error for ${masked}:`, leadErr.message);
        return res.status(500).json({ error: "Failed to create lead" });
      }
      leadId = newLead.id;
    } else {
      await supabase
        .from("leads")
        .update({
          status: "converted",
          program_interest: program,
          last_msg_at: new Date().toISOString(),
        })
        .eq("id", leadId);
    }

    // --- Calculate program end date ---
    const weeks = programDuration(program);
    let programEndsAt = null;
    if (weeks) {
      const end = new Date();
      end.setDate(end.getDate() + weeks * 7);
      programEndsAt = end.toISOString();
    }

    // --- Insert into clients table ---
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .upsert(
        {
          lead_id: leadId,
          phone,
          name: name || null,
          email: email || null,
          program,
          paid_amount: amount ? parseInt(amount, 10) : 0,
          checkout_id: checkout_id || null,
          program_ends_at: programEndsAt,
          status: "active",
        },
        { onConflict: "phone", ignoreDuplicates: false }
      )
      .select()
      .single();

    if (clientErr) {
      console.error(`[exly-webhook] Client upsert error for ${masked}:`, clientErr.message);
      return res.status(500).json({ error: "Failed to create client" });
    }

    // --- Send onboarding WhatsApp template ---
    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || "there"]);

    console.log(
      `[exly-webhook] Client created for ${masked}: program=${program}, ` +
      `amount=${amount || 0}, ends=${programEndsAt || "N/A"}`
    );

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error("[exly-webhook] Unhandled error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
