const crypto = require("crypto");
const { getSupabase } = require("./lib/supabase");
const { sendWhatsApp, normalizePhone, maskPhone } = require("./lib/whatsapp");
const { logMessage } = require("./lib/messages");

const PROGRAM_MAP = {
  "6-week-shred": "6wk_gym",
  "6-week-home": "6wk_home",
  "12-week-custom": "12wk",
  "pcos-warrior": "pcos",
  "40-plus-strong": "40plus",
  "zoom-trial": "zoom_trial",
  "zoom-pack": "zoom_pack",
};

function programDuration(program) {
  if (program === "12wk") return 84;
  if (program === "zoom_trial") return 7;
  if (program === "zoom_pack") return 30;
  return 42;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers["x-exly-signature"] || "";
    const expected = crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(req.body))
      .digest("hex");
    if (sig && sig !== expected) {
      return res.status(401).json({ error: "Invalid signature" });
    }
  }

  const db = getSupabase();

  try {
    const {
      event,
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
      checkout_id,
      currency,
    } = req.body;

    if (event !== "payment.success" && event !== "purchase.completed") {
      return res.json({ action: "ignored", event });
    }

    const phone = normalizePhone(customer_phone || "");
    if (!phone) return res.status(400).json({ error: "No phone" });

    const programKey =
      PROGRAM_MAP[(product_name || "").toLowerCase().replace(/\s+/g, "-")] ||
      "6wk_gym";
    const duration = programDuration(programKey);
    const now = new Date();
    const endsAt = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from("leads")
      .select("id")
      .eq("phone", phone)
      .limit(1)
      .single();

    if (lead) {
      await db
        .from("leads")
        .update({ status: "converted" })
        .eq("id", lead.id);
    }

    const { data: client, error: clientErr } = await db
      .from("clients")
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: customer_name || "",
        email: customer_email || "",
        program: programKey,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || 0,
        checkout_id: checkout_id || null,
        folder_url: `clients/${Date.now()}`,
        status: "active",
      })
      .select()
      .single();

    if (clientErr) {
      console.error("[EXLY]", clientErr.message);
      return res.status(500).json({ error: "Failed to create client" });
    }

    const folderPath = `clients/${client.id}/.keep`;
    await db.storage
      .from("client-files")
      .upload(folderPath, Buffer.from(""), {
        contentType: "text/plain",
        upsert: true,
      });

    await db
      .from("clients")
      .update({ folder_url: `clients/${client.id}` })
      .eq("id", client.id);

    const template = `onboard_${programKey}`;
    await sendWhatsApp(phone, template, {
      name: customer_name || "there",
      templateParams: [customer_name || "there", programKey],
    });
    await logMessage(phone, "out", `Onboarding: ${programKey}`, template);

    console.log(
      `[CONVERSION] ${maskPhone(phone)} → ${programKey} ($${amount || 0})`
    );

    return res.json({
      ok: true,
      action: "converted",
      client_id: client.id,
      program: programKey,
    });
  } catch (err) {
    console.error("[EXLY ERROR]", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
