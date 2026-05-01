const supabase = require("../lib/supabase");
const { sendTemplate, sendText } = require("../lib/whatsapp");
const {
  detectMarket,
  maskPhone,
  classifyIntent,
  isEscalation,
  checkoutUrl,
} = require("../lib/helpers");
const { notifyMaddy } = require("../lib/escalate");

const INTAKE_FORM_URL = "https://www.fitnessbymaddy.com/intake";
const OPT_OUT_KEYWORDS = ["stop", "unsubscribe"];

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { phone, text, name } = req.body || {};

    if (!phone || !text) {
      return res.status(400).json({ error: "Missing phone or text" });
    }

    const masked = maskPhone(phone);
    console.log(`[whatsapp-webhook] Incoming from ${masked}: ${text.slice(0, 80)}`);

    // --- Opt-out check ---
    const lowerText = text.trim().toLowerCase();
    if (OPT_OUT_KEYWORDS.some((kw) => lowerText === kw)) {
      await supabase
        .from("leads")
        .update({ status: "dropped", last_msg_at: new Date().toISOString() })
        .eq("phone", phone);

      console.log(`[whatsapp-webhook] Opt-out from ${masked}`);
      return res.status(200).json({ action: "opt_out" });
    }

    // --- Escalation check ---
    if (isEscalation(text)) {
      await notifyMaddy("Escalation keyword detected in incoming message", {
        phone: masked,
        text: text.slice(0, 200),
      });
      await sendText(
        phone,
        "We've flagged this for Maddy. She'll reach out personally."
      );

      // Still upsert the lead so we don't lose the contact
      await supabase.from("leads").upsert(
        {
          phone,
          name: name || null,
          last_msg_at: new Date().toISOString(),
          market: detectMarket(phone),
        },
        { onConflict: "phone", ignoreDuplicates: false }
      );

      console.log(`[whatsapp-webhook] Escalated message from ${masked}`);
      return res.status(200).json({ action: "escalated" });
    }

    // --- Upsert lead ---
    const { data: existingLead } = await supabase
      .from("leads")
      .select("id, status, program_interest")
      .eq("phone", phone)
      .maybeSingle();

    let lead;

    if (!existingLead) {
      // New lead — insert
      const { data: inserted, error: insertErr } = await supabase
        .from("leads")
        .insert({
          phone,
          name: name || null,
          first_msg: text.slice(0, 500),
          status: "new",
          market: detectMarket(phone),
          last_msg_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertErr) {
        console.error(`[whatsapp-webhook] Insert error for ${masked}:`, insertErr.message);
        return res.status(500).json({ error: "Failed to create lead" });
      }

      lead = inserted;
    } else {
      // Existing lead — update last_msg_at
      const updates = { last_msg_at: new Date().toISOString() };
      if (name && !existingLead.name) updates.name = name;

      const { data: updated, error: updateErr } = await supabase
        .from("leads")
        .update(updates)
        .eq("phone", phone)
        .select()
        .single();

      if (updateErr) {
        console.error(`[whatsapp-webhook] Update error for ${masked}:`, updateErr.message);
      }

      lead = updated || existingLead;
    }

    // --- Intent classification for new leads ---
    if (lead.status === "new") {
      const intent = classifyIntent(text);

      if (intent) {
        // Update lead with program interest
        await supabase
          .from("leads")
          .update({ program_interest: intent, status: "qualified" })
          .eq("id", lead.id);

        const link = checkoutUrl(intent);
        const msg =
          `Great news! Based on what you shared, our *${intent.replace(/_/g, " ")}* program sounds perfect for you.\n\n` +
          `Checkout here: ${link}\n\n` +
          `Please also fill out our quick intake form so Maddy can personalise your plan: ${INTAKE_FORM_URL}?lead_id=${lead.id}`;

        await sendText(phone, msg);
        console.log(`[whatsapp-webhook] Intent=${intent} for ${masked}, sent checkout + intake`);
        return res.status(200).json({ action: "intent_matched", program: intent });
      }

      // No intent detected — send welcome template
      await sendTemplate(phone, "welcome_v1", [name || "there"]);
      console.log(`[whatsapp-webhook] No intent for ${masked}, sent welcome_v1`);
      return res.status(200).json({ action: "welcome_sent" });
    }

    // Existing qualified/converted lead — just acknowledge
    console.log(`[whatsapp-webhook] Message from existing lead ${masked} (status=${lead.status})`);
    return res.status(200).json({ action: "message_logged" });
  } catch (err) {
    console.error("[whatsapp-webhook] Unhandled error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
