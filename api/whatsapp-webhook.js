const { getSupabase } = require("../lib/supabase");
const { sendTemplate, sendText } = require("../lib/whatsapp");
const { checkEscalation } = require("../lib/escalation");
const { detectMarket } = require("../lib/market");

/* ---------- constants ---------- */
const OPT_OUT_PATTERN = /\b(stop|unsubscribe)\b/i;

const PROGRAM_ROUTES = [
  {
    pattern: /fat\s*loss|weight|shred/i,
    program: "6-Week Burn & Build",
    slug: "burn-build",
    checkout: process.env.CHECKOUT_BURN_BUILD || "https://fitnessbymaddy.com/shred",
    intake: process.env.INTAKE_BURN_BUILD || "https://fitnessbymaddy.com/custom",
  },
  {
    pattern: /pcos|hormonal/i,
    program: "PCOS Warrior",
    slug: "pcos-warrior",
    checkout: process.env.CHECKOUT_PCOS || "https://fitnessbymaddy.com/custom",
    intake: process.env.INTAKE_PCOS || "https://fitnessbymaddy.com/custom",
  },
  {
    pattern: /\b40\b|menopause|joints/i,
    program: "40+ Strong",
    slug: "40-strong",
    checkout: process.env.CHECKOUT_40STRONG || "https://fitnessbymaddy.com/custom",
    intake: process.env.INTAKE_40STRONG || "https://fitnessbymaddy.com/custom",
  },
  {
    pattern: /custom|12\s*week|serious/i,
    program: "12-Week Flagship",
    slug: "12-week-flagship",
    checkout: process.env.CHECKOUT_FLAGSHIP || "https://fitnessbymaddy.com/vip",
    intake: process.env.INTAKE_FLAGSHIP || "https://fitnessbymaddy.com/custom",
  },
  {
    pattern: /trial|zoom|not\s*sure/i,
    program: "Zoom Trial",
    slug: "zoom-trial",
    checkout: process.env.CHECKOUT_ZOOM || "https://fitnessbymaddy.com/custom",
    intake: process.env.INTAKE_ZOOM || "https://fitnessbymaddy.com/custom",
  },
];

/* ---------- helpers ---------- */

function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, 3) + "***" + phone.slice(-2);
}

function extractMessage(body) {
  // AiSensy format: { message: { from, text: { body } } }
  if (body.message && body.message.from) {
    return {
      phone: body.message.from,
      text: (body.message.text && body.message.text.body) || "",
    };
  }
  // Meta Cloud API format: nested in entry[].changes[].value.messages[]
  if (body.entry && Array.isArray(body.entry)) {
    for (const entry of body.entry) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const msgs = (change.value && change.value.messages) || [];
        if (msgs.length > 0) {
          return {
            phone: msgs[0].from || "",
            text: (msgs[0].text && msgs[0].text.body) || "",
          };
        }
      }
    }
  }
  // Fallback: top-level fields
  return {
    phone: body.from || body.phone || "",
    text: body.text || body.body || body.message || "",
  };
}

async function logMessage(supabase, phone, direction, body, templateName) {
  try {
    await supabase.from("messages").insert({
      phone,
      direction,
      body: (body || "").slice(0, 4096),
      template_name: templateName || null,
      sent_at: new Date().toISOString(),
      status: "received",
    });
  } catch (err) {
    console.error("logMessage error:", err.message);
  }
}

/* ---------- handler ---------- */

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    return res.status(200).end();
  }

  // GET for webhook verification (Meta requires this)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(200).json({ status: "ok" });
  }

  if (req.method !== "POST") {
    return res.status(200).json({ status: "ignored", reason: "method" });
  }

  try {
    const supabase = getSupabase();
    const { phone, text } = extractMessage(req.body || {});

    if (!phone) {
      console.warn("Webhook received with no phone number");
      return res.status(200).json({ status: "ok", note: "no phone" });
    }

    // Log incoming message
    await logMessage(supabase, phone, "in", text);

    /* ---- opt-out check ---- */
    if (OPT_OUT_PATTERN.test(text)) {
      // Mark lead or client as dropped
      await supabase
        .from("leads")
        .update({ status: "dropped" })
        .eq("phone", phone);
      await supabase
        .from("clients")
        .update({ status: "dropped" })
        .eq("phone", phone);

      await sendText(
        phone,
        "You have been unsubscribed. You will no longer receive messages from FitnessByMaddy. If this was a mistake, reply START."
      );
      await logMessage(supabase, phone, "out", "Opt-out confirmation sent");
      return res.status(200).json({ status: "ok", action: "opt_out" });
    }

    /* ---- escalation check ---- */
    const escalation = await checkEscalation(text, { phone });
    if (escalation.escalated) {
      console.warn(
        `ESCALATION phone=${maskPhone(phone)} reason=${escalation.reason}`
      );
    }

    /* ---- active client check ---- */
    const { data: clientRows } = await supabase
      .from("clients")
      .select("*")
      .eq("phone", phone)
      .eq("status", "active")
      .limit(1);

    if (clientRows && clientRows.length > 0) {
      const client = clientRows[0];
      // Active client replied - acknowledge
      await sendText(
        phone,
        "Thanks for your message! Maddy or the team will get back to you shortly. If this is urgent, please call us directly."
      );
      await logMessage(supabase, phone, "out", "Client auto-acknowledgement");
      return res.status(200).json({ status: "ok", action: "client_reply" });
    }

    /* ---- existing lead check ---- */
    const { data: leadRows } = await supabase
      .from("leads")
      .select("*")
      .eq("phone", phone)
      .limit(1);

    if (leadRows && leadRows.length > 0) {
      const lead = leadRows[0];

      // Update last_msg_at
      await supabase
        .from("leads")
        .update({ last_msg_at: new Date().toISOString() })
        .eq("id", lead.id);

      // Program routing - check keywords in message
      const route = PROGRAM_ROUTES.find((r) => r.pattern.test(text));
      if (route) {
        await supabase
          .from("leads")
          .update({
            program_interest: route.program,
            status: "qualified",
          })
          .eq("id", lead.id);

        const msg =
          `Great choice! The *${route.program}* sounds perfect for you.\n\n` +
          `Here's your next step:\n` +
          `1. Fill out the intake form: ${route.intake}\n` +
          `2. Complete checkout: ${route.checkout}\n\n` +
          `Any questions? Just reply here!`;
        await sendText(phone, msg);
        await logMessage(supabase, phone, "out", `Program route: ${route.program}`);
      } else {
        // No keyword match - send a nudge
        await sendText(
          phone,
          "Thanks for reaching out! Could you tell me more about your fitness goals? For example:\n" +
            "- Fat loss / shred\n" +
            "- PCOS / hormonal balance\n" +
            "- 40+ fitness\n" +
            "- Custom 12-week plan\n" +
            "- Zoom trial session"
        );
        await logMessage(supabase, phone, "out", "Lead nudge sent");
      }

      return res.status(200).json({ status: "ok", action: "existing_lead" });
    }

    /* ---- new lead ---- */
    const market = detectMarket(phone);
    const { data: newLead, error: insertErr } = await supabase
      .from("leads")
      .insert({
        phone,
        source: "whatsapp",
        status: "new",
        first_msg: (text || "").slice(0, 1024),
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) {
      console.error("Lead insert error:", insertErr.message);
    }

    await sendTemplate(phone, "welcome_v1", { name: "there" });
    await logMessage(supabase, phone, "out", "welcome_v1 template sent", "welcome_v1");

    return res.status(200).json({ status: "ok", action: "new_lead" });
  } catch (err) {
    console.error("whatsapp-webhook error:", err.message);
    // Always return 200 for webhooks
    return res.status(200).json({ status: "ok", note: "internal error logged" });
  }
};
