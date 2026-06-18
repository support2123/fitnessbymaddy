const { getSupabase } = require("./_lib/supabase");
const { sendWhatsApp, sendWhatsAppText } = require("./_lib/whatsapp");
const { checkEscalation, notifyMaddy } = require("./_lib/escalation");
const { classifyIntent } = require("./_lib/keywords");
const { detectMarket } = require("./_lib/market");

// ---- Stop / unsubscribe keywords ----
const STOP_WORDS = ["stop", "unsubscribe", "cancel", "opt out", "optout"];

function isStopMessage(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return STOP_WORDS.some((w) => lower === w || lower.startsWith(w));
}

// ---- Checkout / intake links per program ----
const CHECKOUT_LINKS = {
  "6wk_gym": process.env.CHECKOUT_6WK_GYM || "https://fitnessbymaddy.com/checkout/6wk-gym",
  "6wk_home": process.env.CHECKOUT_6WK_HOME || "https://fitnessbymaddy.com/checkout/6wk-home",
  pcos: process.env.CHECKOUT_PCOS || "https://fitnessbymaddy.com/checkout/pcos",
  "40plus": process.env.CHECKOUT_40PLUS || "https://fitnessbymaddy.com/checkout/40plus",
  "12wk": process.env.CHECKOUT_12WK || "https://fitnessbymaddy.com/checkout/12wk",
  zoom_trial: process.env.CHECKOUT_ZOOM_TRIAL || "https://fitnessbymaddy.com/checkout/zoom-trial",
  zoom_pack: process.env.CHECKOUT_ZOOM_PACK || "https://fitnessbymaddy.com/checkout/zoom-pack",
};

const INTAKE_FORM_URL =
  process.env.INTAKE_FORM_URL || "https://fitnessbymaddy.com/intake";

module.exports = async (req, res) => {
  // GET — webhook verification (just return 200)
  if (req.method === "GET") {
    return res.status(200).send("OK");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const phone = body.phone || body.waId;
    const text = body.text || "";
    const senderName = body.pushName || "";
    const timestamp = body.timestamp || new Date().toISOString();

    if (!phone) {
      console.warn("[webhook] Incoming message with no phone — ignoring");
      return res.status(200).json({ ok: true, skipped: true });
    }

    const supabase = getSupabase();

    // ---- Log inbound message ----
    await supabase.from("messages").insert({
      phone,
      direction: "in",
      body: text,
      sent_at: new Date().toISOString(),
    });

    // ---- STOP / Unsubscribe ----
    if (isStopMessage(text)) {
      // Find lead and mark as dropped
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id")
        .eq("phone", phone)
        .limit(1)
        .single();

      if (existingLead) {
        await supabase
          .from("leads")
          .update({ status: "dropped", last_msg_at: new Date().toISOString() })
          .eq("id", existingLead.id);
      }

      console.log(`[webhook] STOP received from ${phone}`);
      return res.status(200).json({ ok: true, action: "stopped" });
    }

    // ---- Check escalation keywords ----
    const escalation = checkEscalation(text);
    if (escalation.shouldEscalate) {
      // Look up lead for context
      const { data: escLead } = await supabase
        .from("leads")
        .select("id")
        .eq("phone", phone)
        .limit(1)
        .single();

      await notifyMaddy(escalation.reason, {
        phone,
        message: text,
        leadId: escLead?.id,
      });

      await sendWhatsAppText(
        phone,
        "Thanks for sharing — Maddy will personally get back to you within 24 hours"
      );

      // Still update last_msg_at
      if (escLead) {
        await supabase
          .from("leads")
          .update({ last_msg_at: new Date().toISOString() })
          .eq("id", escLead.id);
      }

      return res.status(200).json({ ok: true, action: "escalated" });
    }

    // ---- Look up existing lead by phone ----
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("*")
      .eq("phone", phone)
      .limit(1)
      .single();

    const market = detectMarket(phone);
    const now = new Date().toISOString();

    if (!lead || leadErr) {
      // ---- No lead exists: create new lead ----
      const { data: newLead, error: createErr } = await supabase
        .from("leads")
        .insert({
          phone,
          name: senderName || null,
          status: "new",
          source: "whatsapp",
          market,
          last_msg_at: now,
          created_at: now,
        })
        .select()
        .single();

      if (createErr) {
        console.error("[webhook] Failed to create lead:", createErr.message);
        return res.status(200).json({ ok: false, error: "lead_create_failed" });
      }

      // Send welcome template with auto-reply
      await sendWhatsApp(phone, "welcome_v1", [senderName || "there"]);

      console.log(`[webhook] New lead created: ${newLead.id}`);
      return res.status(200).json({ ok: true, action: "new_lead", leadId: newLead.id });
    }

    // ---- Lead exists: update last_msg_at ----
    await supabase
      .from("leads")
      .update({ last_msg_at: now })
      .eq("id", lead.id);

    if (lead.status === "new") {
      // Classify intent from message
      const { program, confidence } = classifyIntent(text);

      const updates = {};
      if (program) {
        updates.program_interest = program;
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from("leads").update(updates).eq("id", lead.id);
      }

      // Send checkout link + intake form
      const checkoutUrl =
        (program && CHECKOUT_LINKS[program]) || CHECKOUT_LINKS["6wk_gym"];

      const replyText = program
        ? `Great choice! Here's your checkout link: ${checkoutUrl}\n\nPlease also fill out your intake form so we can personalise your plan: ${INTAKE_FORM_URL}?lead_id=${lead.id}`
        : `Thanks for reaching out! To get started, please fill out your intake form: ${INTAKE_FORM_URL}?lead_id=${lead.id}\n\nYou can check out our programs here: ${CHECKOUT_LINKS["6wk_gym"]}`;

      await sendWhatsAppText(phone, replyText);

      console.log(`[webhook] Sent checkout + intake to lead ${lead.id} (program: ${program || "unknown"})`);
      return res.status(200).json({ ok: true, action: "sent_links", program });
    }

    if (lead.status === "qualified") {
      // Gentle nudge about completing checkout
      await sendWhatsAppText(
        phone,
        "Hey! Just a quick reminder — your personalised plan is waiting for you. Complete your checkout to get started!"
      );

      console.log(`[webhook] Nudge sent to qualified lead ${lead.id}`);
      return res.status(200).json({ ok: true, action: "nudge_sent" });
    }

    // For any other status (converted, active, dropped, etc.) — just acknowledge
    console.log(`[webhook] Message from lead ${lead.id} (status: ${lead.status})`);
    return res.status(200).json({ ok: true, action: "acknowledged" });
  } catch (err) {
    console.error("[webhook] Unhandled error:", err);
    // Always return 200 to avoid webhook retries
    return res.status(200).json({ ok: false, error: "internal_error" });
  }
};
