// api/whatsapp-webhook.js  —  Handles incoming WhatsApp messages from AiSensy webhook
const { getLeadByPhone, upsertLead, logMessage, supabase } = require("../lib/supabase");
const { sendTemplate, sendTextMessage, detectMarket } = require("../lib/whatsapp");
const { shouldEscalate, detectProgram, maskPhone } = require("../lib/utils");

const MADDY_PHONE = "+917082478374";
const STOP_WORDS = ["stop", "unsubscribe", "opt out", "optout"];

/** Checkout + intake links keyed by program slug from detectProgram() */
const PROGRAM_LINKS = {
  "12wk":       { checkout: "https://fitnessbymaddy.exly.app/12-week-transform", intake: "/intake?p=12wk" },
  "6wk_gym":    { checkout: "https://fitnessbymaddy.exly.app/6-week-gym",        intake: "/intake?p=6wk_gym" },
  "6wk_home":   { checkout: "https://fitnessbymaddy.exly.app/6-week-home",       intake: "/intake?p=6wk_home" },
  pcos:         { checkout: "https://fitnessbymaddy.exly.app/pcos",              intake: "/intake?p=pcos" },
  "40plus":     { checkout: "https://fitnessbymaddy.exly.app/40plus",            intake: "/intake?p=40plus" },
  zoom_trial:   { checkout: "https://fitnessbymaddy.exly.app/zoom-trial",        intake: "/intake?p=zoom_trial" },
  zoom_pack:    { checkout: "https://fitnessbymaddy.exly.app/zoom-pack",         intake: "/intake?p=zoom_pack" },
};

module.exports = async (req, res) => {
  // Webhooks must always return 200 to avoid retries from the sender
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const phone = body.phone;
    const messageText = body.text || body.message || "";
    const senderName = body.name || "";

    if (!phone) {
      console.warn("whatsapp-webhook: missing phone in payload");
      return res.status(200).json({ ok: true, skipped: "no phone" });
    }

    const masked = maskPhone(phone);
    console.log(`whatsapp-webhook: incoming from ${masked}`);

    // ---------------------------------------------------------------
    // Look up existing lead
    // ---------------------------------------------------------------
    const existingLead = await getLeadByPhone(phone);

    // ---------------------------------------------------------------
    // NEW LEAD
    // ---------------------------------------------------------------
    if (!existingLead) {
      console.log(`whatsapp-webhook: new lead ${masked}`);

      const market = detectMarket(phone);
      const lead = await upsertLead({
        phone,
        name: senderName || null,
        status: "new",
        source: "whatsapp",
        market,
        last_msg_at: new Date().toISOString(),
      });

      // Send welcome template (best-effort)
      try {
        await sendTemplate(phone, "welcome_v1", {
          name: senderName || "there",
          templateParams: [senderName || "there"],
        });
      } catch (err) {
        console.error(`whatsapp-webhook: failed to send welcome to ${masked}:`, err.message);
      }

      // Log the inbound message
      await logMessage(phone, "in", messageText, null);

      return res.status(200).json({ ok: true, action: "new_lead", lead_id: lead.id });
    }

    // ---------------------------------------------------------------
    // EXISTING LEAD
    // ---------------------------------------------------------------

    // Update last_msg_at timestamp
    await supabase
      .from("leads")
      .update({ last_msg_at: new Date().toISOString() })
      .eq("phone", phone);

    // Check for STOP / unsubscribe
    if (messageText && STOP_WORDS.some((w) => messageText.toLowerCase().includes(w))) {
      console.log(`whatsapp-webhook: ${masked} requested stop`);
      await supabase
        .from("leads")
        .update({ status: "dropped" })
        .eq("phone", phone);

      await logMessage(phone, "in", messageText, null);
      return res.status(200).json({ ok: true, action: "stopped" });
    }

    // Check for escalation keywords
    if (shouldEscalate(messageText)) {
      console.log(`whatsapp-webhook: escalation triggered by ${masked}`);
      try {
        await sendTextMessage(
          MADDY_PHONE,
          `ESCALATION from ${masked}: "${messageText.slice(0, 200)}"`
        );
      } catch (err) {
        console.error("whatsapp-webhook: failed to notify Maddy:", err.message);
      }
    }

    // Detect program interest
    const program = detectProgram(messageText);
    if (program) {
      console.log(`whatsapp-webhook: ${masked} interested in ${program}`);

      await supabase
        .from("leads")
        .update({ program_interest: program })
        .eq("phone", phone);

      const links = PROGRAM_LINKS[program];
      if (links) {
        try {
          await sendTextMessage(
            phone,
            `Great choice! Here's the checkout link: ${links.checkout}\n\nPlease also fill out the intake form: ${links.intake}`
          );
        } catch (err) {
          console.error(`whatsapp-webhook: failed to send program links to ${masked}:`, err.message);
        }
      }
    }

    // Log the inbound message
    await logMessage(phone, "in", messageText, null);

    return res.status(200).json({ ok: true, action: "processed" });
  } catch (err) {
    console.error("whatsapp-webhook: unhandled error:", err.message);
    // Always return 200 for webhooks to prevent upstream retries
    return res.status(200).json({ ok: true, error: "internal" });
  }
};
