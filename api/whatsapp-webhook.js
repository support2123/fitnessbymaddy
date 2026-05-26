const { supabase } = require("./_lib/supabase");
const { sendTemplate, sendText } = require("./_lib/whatsapp");
const { detectMarket } = require("./_lib/market");
const { checkEscalation, notifyMaddy } = require("./_lib/escalation");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPT_OUT_KEYWORDS = ["stop", "unsubscribe"];

const CHECKOUT_BASE = process.env.EXLY_CHECKOUT_BASE || "https://www.exlyapp.com/fitnessbymaddy";
const INTAKE_FORM_URL = process.env.INTAKE_FORM_URL || "https://fitnessbymaddy.com/custom";

const PROGRAMS = {
  "6wk": {
    keywords: ["fat loss", "weight", "shred", "lean", "lose"],
    name: "6-Week Shred",
    slug: "6wk-shred",
    checkout: `${CHECKOUT_BASE}/6wk-shred`,
  },
  pcos: {
    keywords: ["pcos", "hormonal", "hormone"],
    name: "PCOS Program",
    slug: "pcos",
    checkout: `${CHECKOUT_BASE}/pcos`,
  },
  "40plus": {
    keywords: ["40", "menopause", "joints", "over 40", "joint"],
    name: "40+ Program",
    slug: "40plus",
    checkout: `${CHECKOUT_BASE}/40plus`,
  },
  "12wk": {
    keywords: ["custom", "12 week", "serious", "transform", "flagship"],
    name: "12-Week Flagship",
    slug: "12wk-flagship",
    checkout: `${CHECKOUT_BASE}/12wk-flagship`,
  },
  trial: {
    keywords: ["trial", "zoom", "not sure", "try", "unsure"],
    name: "Zoom Trial Session",
    slug: "zoom-trial",
    checkout: `${CHECKOUT_BASE}/zoom-trial`,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mask phone for safe logging: +91XXXXX67890 → +91XXXXX***90 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, -4).replace(/.(?=.{2})/g, "*").slice(0, -2) + phone.slice(-4, -2) + "**";
}

/** Match message body to a program via keyword detection. */
function matchProgram(body) {
  if (!body) return null;
  const lower = body.toLowerCase();
  for (const [key, program] of Object.entries(PROGRAMS)) {
    for (const kw of program.keywords) {
      if (lower.includes(kw)) {
        return { key, ...program };
      }
    }
  }
  return null;
}

/** Log a message to the messages table. */
async function logMessage(phone, name, body, direction) {
  try {
    await supabase.from("messages").insert({
      phone,
      name: name || null,
      body: body || "",
      direction,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[msg-log] Failed for ${maskPhone(phone)}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  // Only accept POST
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, note: "ignored non-POST" });
  }

  try {
    const payload = req.body || {};

    // AiSensy webhook payload extraction
    const phone = payload.phone || payload.from || payload.senderPhone || "";
    const body = payload.message || payload.text || payload.body || "";
    const name = payload.name || payload.senderName || payload.pushName || "";

    if (!phone) {
      console.warn("[webhook] No phone in payload");
      return res.status(200).json({ ok: true, note: "no phone" });
    }

    // 1. Log incoming message
    await logMessage(phone, name, body, "in");

    // 2. Opt-out check
    const lowerBody = (body || "").trim().toLowerCase();
    if (OPT_OUT_KEYWORDS.includes(lowerBody)) {
      await supabase
        .from("leads")
        .update({ status: "dropped", dropped_reason: "opt-out", updated_at: new Date().toISOString() })
        .eq("phone", phone);
      console.log(`[webhook] Opt-out from ${maskPhone(phone)}`);
      return res.status(200).json({ ok: true, action: "opt-out" });
    }

    // 3. Escalation check
    const esc = checkEscalation(body);
    if (esc.shouldEscalate) {
      await notifyMaddy(esc.reason, { phone, name, message: body });
      console.log(`[webhook] Escalation (${esc.reason}) from ${maskPhone(phone)}`);
      // Continue processing — don't return early so the lead still gets handled
    }

    // 4. Check if active client
    const { data: client } = await supabase
      .from("clients")
      .select("id, status")
      .eq("phone", phone)
      .eq("status", "active")
      .maybeSingle();

    if (client) {
      console.log(`[webhook] Active client ${maskPhone(phone)}, logged message`);
      return res.status(200).json({ ok: true, action: "client-logged" });
    }

    // 5. Check if existing lead
    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();

    if (lead) {
      // Flow B — existing lead with status=new → keyword qualification
      if (lead.status === "new") {
        const program = matchProgram(body);

        if (program) {
          // Send qualification response with checkout + intake links
          const msg = [
            `Great choice! The *${program.name}* sounds perfect for you.`,
            "",
            `Here's your checkout link:`,
            program.checkout,
            "",
            `Please also fill out this quick intake form so I can personalise your plan:`,
            INTAKE_FORM_URL,
            "",
            `Any questions? Just reply here!`,
          ].join("\n");

          await sendText(phone, msg);
          await logMessage(phone, name, msg, "out");

          // Update lead
          await supabase
            .from("leads")
            .update({
              status: "qualified",
              program_interest: program.key,
              updated_at: new Date().toISOString(),
            })
            .eq("id", lead.id);

          console.log(`[webhook] Qualified ${maskPhone(phone)} → ${program.key}`);
        } else {
          console.log(`[webhook] No keyword match from ${maskPhone(phone)}: "${body.slice(0, 50)}"`);
        }
      } else {
        console.log(`[webhook] Existing lead ${maskPhone(phone)} status=${lead.status}, logged`);
      }

      return res.status(200).json({ ok: true, action: "lead-handled" });
    }

    // 6. Flow A — new lead
    const market = detectMarket(phone);
    const { data: newLead, error: insertErr } = await supabase
      .from("leads")
      .insert({
        phone,
        name: name || null,
        status: "new",
        source: "whatsapp",
        market,
        nudge_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // nudge in 24h
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error(`[webhook] Lead insert failed for ${maskPhone(phone)}:`, insertErr.message);
      return res.status(200).json({ ok: true, note: "insert-error" });
    }

    // Send welcome template
    try {
      await sendTemplate(phone, "welcome_v1", {
        name: name || "there",
        templateParams: [name || "there"],
      });
      await logMessage(phone, name, "[template: welcome_v1]", "out");
    } catch (tmplErr) {
      console.error(`[webhook] Template send failed for ${maskPhone(phone)}:`, tmplErr.message);
    }

    console.log(`[webhook] New lead ${maskPhone(phone)} (${market}), id=${newLead?.id}`);
    return res.status(200).json({ ok: true, action: "new-lead" });
  } catch (err) {
    console.error("[webhook] Unhandled error:", err.message);
    return res.status(200).json({ ok: true, error: "internal" });
  }
};
