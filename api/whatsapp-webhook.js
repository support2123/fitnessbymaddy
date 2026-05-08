const { getSupabase } = require("../lib/supabase");
const { sendWhatsApp, maskPhone } = require("../lib/whatsapp");
const { detectMarket, isHinglish } = require("../lib/market");
const { needsEscalation, isOptOut, escalateToMaddy } = require("../lib/escalation");
const { routeByKeyword } = require("../lib/routing");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone || "";
    const messageBody = payload.message || payload.text || payload.body || "";
    const senderName = payload.name || payload.senderName || "";

    if (!phone) return res.status(400).json({ error: "Missing phone" });

    const db = getSupabase();

    await db.from("messages").insert({
      phone,
      direction: "in",
      body: messageBody,
      sent_at: new Date().toISOString(),
      status: "received",
    });

    if (isOptOut(messageBody)) {
      await db
        .from("leads")
        .update({ status: "dropped" })
        .eq("phone", phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: "opted_out" });
    }

    if (needsEscalation(messageBody)) {
      await escalateToMaddy("keyword_trigger", phone, messageBody);
      return res.status(200).json({ action: "escalated" });
    }

    const { data: existingLead } = await db
      .from("leads")
      .select("id, status")
      .eq("phone", phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, senderName, messageBody, res);
    }

    if (existingLead.status === "dropped") {
      return res.status(200).json({ action: "dropped_lead_ignored" });
    }

    return await handleReply(db, existingLead, phone, messageBody, res);
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};

async function handleNewLead(db, phone, name, messageBody, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db
    .from("leads")
    .insert({
      phone,
      name: name || null,
      source: "whatsapp",
      status: "new",
      first_msg: messageBody,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  const hinglish = isHinglish(market);
  const welcomeTemplate = hinglish ? "welcome_v1_hi" : "welcome_v1";
  await sendWhatsApp(phone, welcomeTemplate, [name || "there"]);

  const route = routeByKeyword(messageBody);
  if (route) {
    await db
      .from("leads")
      .update({ program_interest: route.program, status: "qualified" })
      .eq("id", lead.id);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.checkoutPath}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;
    const templateName = hinglish ? "program_link_hi" : "program_link";
    await sendWhatsApp(phone, templateName, [
      route.name,
      `$${route.price}`,
      checkoutUrl,
      intakeUrl,
    ]);
  }

  return res.status(200).json({ action: "new_lead", leadId: lead.id });
}

async function handleReply(db, lead, phone, messageBody, res) {
  await db
    .from("leads")
    .update({ last_msg_at: new Date().toISOString() })
    .eq("id", lead.id);

  if (lead.status === "new" || lead.status === "qualified") {
    const route = routeByKeyword(messageBody);
    if (route) {
      const market = detectMarket(phone);
      await db
        .from("leads")
        .update({ program_interest: route.program, status: "qualified" })
        .eq("id", lead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.checkoutPath}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;
      const templateName = isHinglish(market) ? "program_link_hi" : "program_link";
      await sendWhatsApp(phone, templateName, [
        route.name,
        `$${route.price}`,
        checkoutUrl,
        intakeUrl,
      ]);

      return res.status(200).json({ action: "qualified", program: route.program });
    }
  }

  return res.status(200).json({ action: "reply_logged" });
}
