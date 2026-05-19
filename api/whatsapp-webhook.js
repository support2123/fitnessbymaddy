const { supabase } = require("../lib/supabase");
const { sendWhatsApp } = require("../lib/whatsapp");
const {
  isEscalationTrigger,
  classifyIntent,
  programDetails,
  maskPhone,
} = require("../lib/utils");

const MADDY_PHONE = "+917082478374";
const BASE_URL = process.env.BASE_URL || "https://fitnessbymaddy.com";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const phone = body.phone || body.mobile;
    const messageText = body.text || body.message || "";
    const senderName = body.name || "";

    if (!phone) {
      return res.status(400).json({ error: "Missing phone number" });
    }

    // ── Log incoming message ──────────────────────────────────────
    const { error: logError } = await supabase.from("messages").insert({
      phone,
      direction: "in",
      body: messageText,
      sent_at: new Date().toISOString(),
      status: "received",
    });

    if (logError) {
      console.error(
        `[webhook] Failed to log incoming message from ${maskPhone(phone)}: ${logError.message}`
      );
    }

    // ── Check for STOP / unsubscribe ──────────────────────────────
    const lowerText = messageText.toLowerCase().trim();
    if (lowerText === "stop" || lowerText === "unsubscribe") {
      await supabase
        .from("leads")
        .update({ status: "dropped" })
        .eq("phone", phone);

      return res.status(200).json({ action: "unsubscribed" });
    }

    // ── Check for escalation triggers ─────────────────────────────
    if (isEscalationTrigger(messageText)) {
      await sendWhatsApp(MADDY_PHONE, "escalation_alert", {
        templateParams: [maskPhone(phone), messageText.slice(0, 200)],
      });
    }

    // ── Look up lead ──────────────────────────────────────────────
    const { data: existingLead } = await supabase
      .from("leads")
      .select("*")
      .eq("phone", phone)
      .single();

    if (!existingLead) {
      // New lead
      const { error: insertError } = await supabase.from("leads").insert({
        phone,
        name: senderName || null,
        status: "new",
        source: "whatsapp",
        created_at: new Date().toISOString(),
      });

      if (insertError) {
        console.error(
          `[webhook] Failed to insert lead for ${maskPhone(phone)}: ${insertError.message}`
        );
      }

      await sendWhatsApp(phone, "welcome_v1", {
        name: senderName || "there",
        templateParams: [senderName || "there"],
      });

      return res.status(200).json({ action: "new_lead", template: "welcome_v1" });
    }

    // ── Existing lead: classify intent and route ──────────────────
    const program = classifyIntent(messageText);

    if (program && programDetails[program]) {
      const details = programDetails[program];
      const checkoutLink = details.checkoutUrl;
      const intakeLink = `${BASE_URL}/intake.html?lead=${existingLead.id}`;

      await sendWhatsApp(phone, "program_info", {
        name: existingLead.name || senderName || "there",
        templateParams: [
          existingLead.name || senderName || "there",
          details.name,
          `$${details.price}`,
          checkoutLink,
          intakeLink,
        ],
      });

      // Update lead with program interest
      await supabase
        .from("leads")
        .update({ program_interest: program })
        .eq("id", existingLead.id);

      return res.status(200).json({
        action: "intent_matched",
        program,
        template: "program_info",
      });
    }

    // No specific intent matched — acknowledge the message
    return res.status(200).json({
      action: "message_received",
      lead_id: existingLead.id,
    });
  } catch (err) {
    console.error(`[webhook] Unhandled error: ${err.message}`);
    return res.status(500).json({ error: "Internal server error" });
  }
};
