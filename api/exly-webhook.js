const crypto = require("crypto");
const { getSupabase } = require("../lib/supabase");
const { sendTemplate } = require("../lib/whatsapp");
const { PROGRAM_DURATIONS_WEEKS, maskPhone } = require("../lib/utils");

module.exports = async function handler(req, res) {
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

    const {
      phone,
      email,
      name,
      product_name,
      amount,
      checkout_id,
      status,
    } = req.body;

    if (status !== "paid" && status !== "completed") {
      return res.status(200).json({ action: "ignored_non_paid" });
    }

    if (!phone) return res.status(400).json({ error: "phone required" });

    const db = getSupabase();

    const program = mapProductToProgram(product_name);
    const durationWeeks = PROGRAM_DURATIONS_WEEKS[program] || 6;

    const { data: lead } = await db
      .from("leads")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();

    let leadId = lead?.id;
    if (!lead) {
      const { data: newLead } = await db
        .from("leads")
        .insert({
          phone,
          name,
          source: "exly_purchase",
          status: "converted",
          market: "GLOBAL",
        })
        .select()
        .single();
      leadId = newLead.id;
    } else {
      await db.from("leads").update({ status: "converted" }).eq("id", lead.id);
    }

    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + durationWeeks * 7);

    const { data: client } = await db
      .from("clients")
      .insert({
        lead_id: leadId,
        phone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        folder_url: `/clients/${leadId}/`,
        status: "active",
      })
      .select()
      .single();

    await db.storage.from("clients").upload(
      `${client.id}/.keep`,
      Buffer.from(""),
      { contentType: "text/plain", upsert: true }
    );

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [
      name || "there",
      `${durationWeeks} weeks`,
    ]);

    if (program === "12wk") {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error("Week-1 program generation failed:", genErr.message);
      }
    }

    console.log(`New client: ${maskPhone(phone)} → ${program}`);
    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error("exly-webhook error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return "6wk_gym";
  const lower = productName.toLowerCase();
  if (lower.includes("12") || lower.includes("custom") || lower.includes("flagship")) return "12wk";
  if (lower.includes("pcos") || lower.includes("hormonal")) return "pcos";
  if (lower.includes("40") || lower.includes("strong")) return "40plus";
  if (lower.includes("trial") || lower.includes("zoom trial")) return "zoom_trial";
  if (lower.includes("zoom pack") || lower.includes("session pack")) return "zoom_pack";
  if (lower.includes("home") || lower.includes("bodyweight")) return "6wk_home";
  return "6wk_gym";
}
