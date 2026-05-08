const crypto = require("crypto");
const { getSupabase } = require("../lib/supabase");
const { sendWhatsAppForced } = require("../lib/whatsapp");
const { detectMarket, isHinglish } = require("../lib/market");

const PROGRAM_LOOKUP = {
  "6wk-burn-build": "6wk_gym",
  "6wk-home": "6wk_home",
  "12wk-flagship": "12wk",
  "pcos-warrior": "pcos",
  "40plus-strong": "40plus",
  "zoom-trial": "zoom_trial",
  "zoom-pack": "zoom_pack",
};

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const signature = req.headers["x-exly-signature"] || "";
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac("sha256", process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest("hex");
      if (signature !== expected) {
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    const {
      phone,
      email,
      name,
      checkout_id,
      product_id,
      amount,
      status,
    } = req.body;

    if (status !== "paid" && status !== "completed") {
      if (status === "failed" && phone) {
        const { getSupabase: gs } = require("../lib/supabase");
        const { escalateToMaddy: esc } = require("../lib/escalation");
        const db = gs();
        const { data: client } = await db
          .from("clients")
          .select("id")
          .eq("phone", phone)
          .eq("status", "active")
          .single();
        if (client) {
          await esc("payment_failure", phone, `Payment failed for active client. Checkout: ${checkout_id}`);
        }
      }
      return res.status(200).json({ action: "ignored", status });
    }

    const db = getSupabase();
    const programKey = PROGRAM_LOOKUP[product_id] || product_id || "6wk_gym";

    const { data: lead } = await db
      .from("leads")
      .select("id, phone, name, market")
      .eq("phone", phone)
      .single();

    const leadId = lead ? lead.id : null;

    if (lead) {
      await db
        .from("leads")
        .update({ status: "converted" })
        .eq("id", lead.id);
    }

    const programDuration = programKey === "12wk" ? 84 : programKey.startsWith("6wk") ? 42 : 30;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programDuration * 24 * 60 * 60 * 1000);

    const { data: client } = await db
      .from("clients")
      .insert({
        lead_id: leadId,
        phone,
        name: name || (lead && lead.name) || null,
        email: email || null,
        program: programKey,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: parseInt(amount) || 0,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: "active",
      })
      .select()
      .single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from("client-files").upload(
      `${folderPath}/.keep`,
      new Uint8Array([]),
      { contentType: "application/octet-stream", upsert: true }
    );
    await db
      .from("clients")
      .update({ folder_url: folderPath })
      .eq("id", client.id);

    const market = (lead && lead.market) || detectMarket(phone);
    const hinglish = isHinglish(market);
    const templateName = hinglish ? `onboard_${programKey}_hi` : `onboard_${programKey}`;
    await sendWhatsAppForced(phone, templateName, [name || "there"]);

    if (programKey === "12wk") {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "https://fitnessbymaddy.com";
        await fetch(`${baseUrl}/api/generate-program`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error("Week-1 program gen failed:", e.message);
      }
    }

    return res.status(200).json({ ok: true, clientId: client.id });
  } catch (err) {
    console.error("Exly webhook error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
