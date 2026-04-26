const crypto = require("crypto");
const { supabase } = require("./lib/supabase");
const { sendTemplate } = require("./lib/whatsapp");
const { detectMarket } = require("./lib/utils");

const PROGRAM_DURATIONS = {
  "6wk_gym": 42,
  "6wk_home": 42,
  "12wk": 84,
  pcos: 42,
  "40plus": 42,
  zoom_trial: 7,
  zoom_pack: 28,
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://fitnessbymaddy.com");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    const signature = req.headers["x-exly-signature"] || req.headers["x-webhook-signature"] || "";

    if (secret) {
      const expected = crypto
        .createHmac("sha256", secret)
        .update(JSON.stringify(req.body))
        .digest("hex");

      if (signature !== expected) {
        return res.status(401).json({ error: "Invalid webhook signature" });
      }
    }

    const body = req.body || {};
    const phone = (body.customer_phone || body.phone || "").trim();
    const email = body.customer_email || body.email || null;
    const name = body.customer_name || body.name || null;
    const program = body.product || body.program || null;
    const amount = body.amount || body.paid_amount || null;
    const checkout_id = body.checkout_id || body.order_id || null;

    if (!phone || !program) {
      return res.status(400).json({ error: "Missing required fields: phone, program" });
    }

    let { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("phone", phone)
      .single();

    if (!lead) {
      const market = detectMarket(phone);
      const { data: newLead, error: insertErr } = await supabase
        .from("leads")
        .insert({
          phone,
          name,
          source: "exly",
          status: "converted",
          market,
          last_msg_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertErr) {
        console.error("Failed to create lead:", insertErr.message);
        return res.status(500).json({ error: "Failed to create lead" });
      }
      lead = newLead;
    } else {
      await supabase
        .from("leads")
        .update({
          status: "converted",
          name: name || lead.name,
          program_interest: program,
          last_msg_at: new Date().toISOString(),
        })
        .eq("id", lead.id);
    }

    const now = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { error: clientErr } = await supabase.from("clients").insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id,
      status: "active",
    });

    if (clientErr) {
      console.error("Failed to create client:", clientErr.message);
      return res.status(500).json({ error: "Failed to create client" });
    }

    await sendTemplate(phone, `onboard_${program}`, [name || "there"]);

    return res.status(200).json({ ok: true, lead_id: lead.id });
  } catch (err) {
    console.error("exly-webhook error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
