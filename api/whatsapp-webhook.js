const { supabase } = require("./_lib/supabase");
const {
  sendTemplate,
  logMessage,
  checkRateLimit,
  maskPhone,
} = require("./_lib/whatsapp");
const { detectMarket } = require("./_lib/market");
const { checkEscalation, notifyMaddy } = require("./_lib/escalation");

/* ------------------------------------------------------------------ */
/*  Qualification keyword map                                         */
/* ------------------------------------------------------------------ */
const QUALIFICATION_RULES = [
  {
    keywords: ["fat loss", "weight", "shred"],
    program_interest: "6wk_gym",
    template: "qualify_shred",
  },
  {
    keywords: ["pcos", "hormonal"],
    program_interest: "pcos",
    template: "qualify_pcos",
  },
  {
    keywords: ["40", "menopause", "joints"],
    program_interest: "40plus",
    template: "qualify_40plus",
  },
  {
    keywords: ["custom", "12 week", "serious"],
    program_interest: "12wk",
    template: "qualify_12wk",
  },
  {
    keywords: ["trial", "zoom", "not sure"],
    program_interest: "zoom_trial",
    template: "qualify_trial",
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Extract phone, message text, and sender name from the AiSensy webhook
 * payload. AiSensy may send different shapes — we handle the common ones.
 */
function parsePayload(body) {
  if (!body) return { phone: null, text: null, name: null };

  // Format A – flat AiSensy payload
  //   { senderPhone, senderName, message }
  // Format B – WhatsApp Cloud-API-style nested payload
  //   { entry: [{ changes: [{ value: { messages: [{ from, text: { body } }], contacts: [{ profile: { name } }] } }] }] }

  // Try flat format first
  const phone =
    body.senderPhone ||
    body.from ||
    body.phone ||
    body.sender_phone ||
    null;

  const text =
    body.message ||
    body.text ||
    body.body ||
    body.msg ||
    null;

  const name =
    body.senderName ||
    body.sender_name ||
    body.name ||
    body.pushName ||
    null;

  if (phone) return { phone: String(phone), text: text ? String(text) : null, name: name ? String(name) : null };

  // Try nested Cloud API format
  try {
    const entry = body.entry && body.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const value = change && change.value;
    if (value && value.messages && value.messages[0]) {
      const msg = value.messages[0];
      const contact = value.contacts && value.contacts[0];
      return {
        phone: String(msg.from),
        text: msg.text ? String(msg.text.body) : null,
        name: contact && contact.profile ? String(contact.profile.name) : null,
      };
    }
  } catch (_) {
    /* fall through */
  }

  return { phone: null, text: null, name: null };
}

/**
 * Find the first matching qualification rule for the given message text.
 * Returns the matching rule object or null.
 */
function matchQualification(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const rule of QUALIFICATION_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return rule;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Handler                                                           */
/* ------------------------------------------------------------------ */

module.exports = async function handler(req, res) {
  /* ---------- GET: webhook verification ---------- */
  if (req.method === "GET") {
    const challenge = req.query && req.query["hub.challenge"];
    return res.status(200).send(challenge || "OK");
  }

  /* ---------- Only accept POST from here ---------- */
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true });
  }

  try {
    const { phone, text, name } = parsePayload(req.body);

    if (!phone) {
      console.warn("[webhook] Received payload with no phone number — ignoring");
      return res.status(200).json({ ok: true });
    }

    const safePhone = maskPhone(phone);

    /* ---------- Opt-out check ---------- */
    if (text && /\b(stop|unsubscribe)\b/i.test(text)) {
      console.log(`[webhook] Opt-out received from ${safePhone}`);
      await supabase
        .from("leads")
        .update({ status: "dropped", updated_at: new Date().toISOString() })
        .eq("phone", phone);
      return res.status(200).json({ ok: true, action: "opted_out" });
    }

    /* ---------- Escalation check ---------- */
    const escalation = checkEscalation(text);
    if (escalation) {
      console.log(`[webhook] Escalation triggered for ${safePhone}: ${escalation.reason}`);
      await notifyMaddy({ phone, name, text, reason: escalation.reason });
    }

    /* ---------- Log incoming message ---------- */
    await logMessage(phone, "inbound", text || "", null);

    /* ---------- Look up or create lead ---------- */
    const { data: existingLeads, error: lookupError } = await supabase
      .from("leads")
      .select("*")
      .eq("phone", phone)
      .limit(1);

    if (lookupError) {
      console.error(`[webhook] Lead lookup failed for ${safePhone}: ${lookupError.message}`);
    }

    let lead = existingLeads && existingLeads[0];
    let isNew = false;

    if (lead) {
      // Existing lead — update last_msg_at
      await supabase
        .from("leads")
        .update({ last_msg_at: new Date().toISOString() })
        .eq("phone", phone);
    } else {
      // New lead — insert
      isNew = true;
      const market = detectMarket(phone);
      const { data: inserted, error: insertError } = await supabase
        .from("leads")
        .insert({
          phone,
          name: name || null,
          status: "new",
          market,
          last_msg_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        console.error(`[webhook] Lead insert failed for ${safePhone}: ${insertError.message}`);
      } else {
        lead = inserted;
      }
    }

    /* ---------- Rate-limit check before sending templates ---------- */
    const rateLimited = await checkRateLimit(phone);
    if (rateLimited) {
      console.log(`[webhook] Rate-limited — skipping template for ${safePhone}`);
      return res.status(200).json({ ok: true, action: "rate_limited" });
    }

    /* ---------- Qualification routing ---------- */
    const match = matchQualification(text);

    if (match) {
      console.log(`[webhook] Qualified ${safePhone} → ${match.program_interest}`);

      // Send qualification template
      await sendTemplate(phone, match.template, [name || "there"]);

      // Update lead
      await supabase
        .from("leads")
        .update({
          program_interest: match.program_interest,
          status: "qualified",
          updated_at: new Date().toISOString(),
        })
        .eq("phone", phone);

      return res.status(200).json({ ok: true, action: "qualified", program: match.program_interest });
    }

    /* ---------- New lead with no keyword match → welcome ---------- */
    if (isNew || (lead && lead.status === "new")) {
      console.log(`[webhook] Sending welcome to new lead ${safePhone}`);
      await sendTemplate(phone, "welcome_v1", [name || "there"]);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    // Always return 200 for webhooks to prevent retries
    const safePhone = (() => {
      try {
        const { phone } = parsePayload(req.body);
        return phone ? maskPhone(phone) : "unknown";
      } catch (_) {
        return "unknown";
      }
    })();
    console.error(`[webhook] Unhandled error for ${safePhone}: ${err.message}`);
    return res.status(200).json({ ok: false, error: "internal" });
  }
};
