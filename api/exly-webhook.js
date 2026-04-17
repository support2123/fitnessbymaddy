const { getSupabase } = require("./lib/supabase");
const { sendTemplate, maskPhone } = require("./lib/whatsapp");
const { notifyMaddy } = require("./lib/whatsapp");
const crypto = require("crypto");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const signature = req.headers["x-exly-signature"];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac("sha256", process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest("hex");
      if (signature !== expected) {
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    const db = getSupabase();
    const {
      phone,
      email,
      name,
      product_id,
      amount,
      checkout_id,
      status: paymentStatus,
    } = req.body;

    if (paymentStatus !== "completed" && paymentStatus !== "success") {
      if (paymentStatus === "failed") {
        const { data: existingClient } = await db
          .from("clients")
          .select("id")
          .eq("phone", normalizePhone(phone))
          .eq("status", "active")
          .single();

        if (existingClient) {
          await notifyMaddy(
            "Payment Failed — Active Client",
            `Client: ${name} (${maskPhone(phone)})\nAmount: $${amount}`
          );
        }
      }
      return res.status(200).json({ action: "ignored", status: paymentStatus });
    }

    const normalizedPhone = normalizePhone(phone);
    const programKey = mapProductToProgram(product_id);
    const programDuration = getProgramDuration(programKey);
    const now = new Date();
    const endsAt = new Date(now.getTime() + programDuration * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from("leads")
      .select("*")
      .eq("phone", normalizedPhone)
      .single();

    if (lead) {
      await db
        .from("leads")
        .update({ status: "converted" })
        .eq("id", lead.id);
    }

    const { data: client } = await db
      .from("clients")
      .insert({
        lead_id: lead ? lead.id : null,
        phone: normalizedPhone,
        name: name || (lead ? lead.name : null),
        email: email || null,
        program: programKey,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: parseFloat(amount) || 0,
        checkout_id: checkout_id || null,
        status: "active",
      })
      .select()
      .single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from("client-files").upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: "text/plain",
      upsert: true,
    });

    await db
      .from("clients")
      .update({ folder_url: folderPath })
      .eq("id", client.id);

    await sendTemplate(normalizedPhone, `onboard_${programKey}`, [
      name || "there",
    ]);

    if (programKey === "12wk") {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "";
        await fetch(`${baseUrl}/api/generate-program`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error("Week 1 generation trigger failed:", genErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program: programKey,
    });
  } catch (err) {
    console.error("Exly webhook error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, "");
  if (!cleaned.startsWith("+")) cleaned = "+" + cleaned;
  return cleaned;
}

function mapProductToProgram(productId) {
  const map = {
    "6wk_gym": "6wk_gym",
    "6wk_home": "6wk_home",
    "12wk": "12wk",
    pcos: "pcos",
    "40plus": "40plus",
    zoom_trial: "zoom_trial",
    zoom_pack: "zoom_pack",
  };
  return map[productId] || "6wk_gym";
}

function getProgramDuration(programKey) {
  const durations = {
    "6wk_gym": 6,
    "6wk_home": 6,
    "12wk": 12,
    pcos: 6,
    "40plus": 6,
    zoom_trial: 1,
    zoom_pack: 4,
  };
  return durations[programKey] || 6;
}
