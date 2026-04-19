const { getSupabase } = require("../lib/supabase");
const { sendTemplate, sendSession, logMessage, canSendMessage } = require("../lib/whatsapp");
const { detectMarket, classifyIntent, needsEscalation, maskPhone, PROGRAM_NAMES } = require("../lib/utils");
const { escalateToMaddy } = require("../lib/escalation");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.senderPhone || payload.from;
    const text = payload.text || payload.message || payload.body || "";
    const senderName = payload.senderName || payload.name || null;

    if (!phone) return res.status(400).json({ error: "No phone number" });

    const db = getSupabase();

    await logMessage(phone, "in", text, null);

    if (/\b(stop|unsubscribe|opt.?out)\b/i.test(text)) {
      await db.from("leads").update({ status: "dropped" }).eq("phone", phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: "opted_out" });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy("Medical/Safety flag from lead", {
        phone,
        message: text.slice(0, 200),
      });
    }

    const { data: existingLead } = await db
      .from("leads")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();

    if (!existingLead) {
      return await handleNewLead(db, phone, text, senderName, res);
    }

    if (existingLead.status === "dropped") {
      return res.status(200).json({ action: "dropped_lead_ignored" });
    }

    return await handleExistingLead(db, existingLead, text, res);
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};

async function handleNewLead(db, phone, text, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db
    .from("leads")
    .insert({
      phone,
      name,
      source: "whatsapp",
      status: "new",
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
    })
    .select()
    .single();

  const intent = classifyIntent(text);

  if (intent && intent !== "OPT_OUT") {
    await db.from("leads").update({
      status: "qualified",
      program_interest: intent,
    }).eq("id", lead.id);

    await sendQualificationReply(phone, intent, market, lead.id);
    return res.status(200).json({ action: "qualified", program: intent });
  }

  if (market === "IN") {
    await sendTemplate(phone, "welcome_v1", [
      name || "there",
    ]);
  } else {
    await sendTemplate(phone, "welcome_v1_en", [
      name || "there",
    ]);
  }

  return res.status(200).json({ action: "new_lead_welcomed", lead_id: lead.id });
}

async function handleExistingLead(db, lead, text, res) {
  await db.from("leads").update({ last_msg_at: new Date().toISOString() }).eq("id", lead.id);

  const intent = classifyIntent(text);

  if (intent === "OPT_OUT") {
    await db.from("leads").update({ status: "dropped" }).eq("id", lead.id);
    return res.status(200).json({ action: "opted_out" });
  }

  if (intent && lead.status === "new") {
    await db.from("leads").update({
      status: "qualified",
      program_interest: intent,
    }).eq("id", lead.id);

    const canSend = await canSendMessage(lead.phone);
    if (canSend) {
      await sendQualificationReply(lead.phone, intent, lead.market, lead.id);
    }
    return res.status(200).json({ action: "qualified", program: intent });
  }

  return res.status(200).json({ action: "message_logged" });
}

async function sendQualificationReply(phone, program, market, leadId) {
  const programName = PROGRAM_NAMES[program] || program;
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;

  if (market === "IN") {
    await sendTemplate(phone, "program_match", [
      programName,
      checkoutUrl,
      intakeUrl,
    ]);
  } else {
    await sendTemplate(phone, "program_match_en", [
      programName,
      checkoutUrl,
      intakeUrl,
    ]);
  }
}
