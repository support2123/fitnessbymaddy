const { supabase } = require("./lib/supabase");
const { sendTemplate, sendText } = require("./lib/whatsapp");
const {
  detectMarket,
  maskPhone,
  parseKeywords,
  checkEscalation,
  isOptOut,
} = require("./lib/utils");

const MADDY_PHONE = "+917082478374";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://fitnessbymaddy.com");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const payload = req.body || {};
    const message = payload.message || {};
    const phone = (message.from || "").trim();
    const msgBody = (message.text && message.text.body) || "";

    if (!phone) {
      return res.status(400).json({ error: "Missing phone number" });
    }

    await supabase.from("messages").insert({
      phone,
      direction: "in",
      body: msgBody,
    });

    if (isOptOut(msgBody)) {
      await supabase
        .from("leads")
        .update({ status: "dropped", last_msg_at: new Date().toISOString() })
        .eq("phone", phone);
      console.log(`Opt-out received from ${maskPhone(phone)}`);
      return res.status(200).json({ ok: true, action: "opted_out" });
    }

    const escalation = checkEscalation(msgBody);
    if (escalation.shouldEscalate) {
      await sendText(
        MADDY_PHONE,
        `ESCALATION from ${phone}: "${escalation.reason}"\nMessage: ${msgBody}`
      );
    }

    const { data: existingLead } = await supabase
      .from("leads")
      .select("*")
      .eq("phone", phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead, error: insertErr } = await supabase
        .from("leads")
        .insert({
          phone,
          source: "whatsapp",
          status: "new",
          market,
          first_msg: msgBody,
          last_msg_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertErr) {
        console.error("Failed to insert lead:", insertErr.message);
        return res.status(500).json({ error: "Failed to create lead" });
      }

      await sendTemplate(phone, "welcome_v1", []);
      return res.status(200).json({ ok: true, action: "new_lead", lead_id: newLead.id });
    }

    if (existingLead.status === "dropped") {
      return res.status(200).json({ ok: true, action: "ignored_dropped" });
    }

    if (existingLead.status === "new") {
      const program = parseKeywords(msgBody);
      if (program) {
        await supabase
          .from("leads")
          .update({
            program_interest: program,
            status: "qualified",
            last_msg_at: new Date().toISOString(),
          })
          .eq("id", existingLead.id);

        const checkoutLink = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
        const intakeLink = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        await sendTemplate(phone, `checkout_${program}`, [checkoutLink, intakeLink]);
        return res.status(200).json({ ok: true, action: "qualified", program });
      }

      await supabase
        .from("leads")
        .update({ last_msg_at: new Date().toISOString() })
        .eq("id", existingLead.id);

      return res.status(200).json({ ok: true, action: "awaiting_qualification" });
    }

    await supabase
      .from("leads")
      .update({ last_msg_at: new Date().toISOString() })
      .eq("id", existingLead.id);

    return res.status(200).json({ ok: true, action: "updated" });
  } catch (err) {
    console.error("whatsapp-webhook error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
