const { getSupabase } = require("./lib/supabase");
const { sendTemplate, sendText, detectMarket, maskPhone } = require("./lib/whatsapp");
const { needsEscalation, escalate } = require("./lib/escalation");
const { qualifyLead, getProgramDetails, getCheckoutUrl } = require("./lib/qualify");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body;
    const phone = normalizePhone(body.senderPhone || body.from || body.phone);
    const message = body.message || body.text || body.body || "";
    const senderName = body.senderName || body.name || "";

    if (!phone || !message) {
      return res.status(400).json({ error: "Missing phone or message" });
    }

    const db = getSupabase();

    await db.from("messages").insert({
      phone,
      direction: "in",
      body: message,
      sent_at: new Date().toISOString(),
      status: "received",
    });

    if (isOptOut(message)) {
      await db
        .from("leads")
        .update({ status: "dropped" })
        .eq("phone", phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: "opted_out" });
    }

    if (needsEscalation(message)) {
      await escalate(phone, "Keyword trigger in message", message);
    }

    const { data: existingLead } = await db
      .from("leads")
      .select("*")
      .eq("phone", phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, senderName, message, res);
    }

    if (existingLead.status === "dropped") {
      return res.status(200).json({ action: "ignored_dropped" });
    }

    if (existingLead.status === "new") {
      return await handleQualification(db, existingLead, message, res);
    }

    return res.status(200).json({ action: "logged" });
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db
    .from("leads")
    .insert({
      phone,
      name: name || null,
      source: "whatsapp",
      status: "new",
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  const isHinglish = market === "IN";

  if (isHinglish) {
    await sendTemplate(phone, "welcome_v1", [name || "there"]);
  } else {
    await sendTemplate(phone, "welcome_v1_en", [name || "there"]);
  }

  const program = qualifyLead(message);
  if (program) {
    return await routeToProgram(db, lead, program, res);
  }

  return res.status(200).json({ action: "new_lead_welcomed", lead_id: lead.id });
}

async function handleQualification(db, lead, message, res) {
  const program = qualifyLead(message);

  if (!program) {
    await db
      .from("leads")
      .update({ last_msg_at: new Date().toISOString() })
      .eq("id", lead.id);
    return res.status(200).json({ action: "awaiting_qualification" });
  }

  return await routeToProgram(db, lead, program, res);
}

async function routeToProgram(db, lead, programKey, res) {
  const details = getProgramDetails(programKey);
  const checkoutUrl = getCheckoutUrl(programKey);
  const market = lead.market || detectMarket(lead.phone);
  const isHinglish = market === "IN";

  await db
    .from("leads")
    .update({
      status: "qualified",
      program_interest: programKey,
      last_msg_at: new Date().toISOString(),
    })
    .eq("id", lead.id);

  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  let msg;
  if (isHinglish) {
    msg = `Perfect choice! 🔥 ${details.name} program — $${details.price}\n\n` +
      `Checkout karo: ${checkoutUrl}\n\n` +
      `Aur ye intake form bhi fill kardo taaki hum tumhare liye best plan banayein:\n${intakeUrl}`;
  } else {
    msg = `Great choice! 🔥 ${details.name} — $${details.price}\n\n` +
      `Complete your purchase: ${checkoutUrl}\n\n` +
      `Also fill out this intake form so we can customize your plan:\n${intakeUrl}`;
  }

  await sendText(lead.phone, msg);

  return res.status(200).json({
    action: "qualified",
    program: programKey,
    lead_id: lead.id,
  });
}

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, "");
  if (!cleaned.startsWith("+")) cleaned = "+" + cleaned;
  return cleaned;
}

function isOptOut(message) {
  const lower = message.toLowerCase().trim();
  return lower === "stop" || lower === "unsubscribe" || lower === "opt out";
}
