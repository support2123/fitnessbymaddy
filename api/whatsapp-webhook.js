const { getSupabase } = require("./_lib/supabase");
const { sendWhatsApp, sendTextMessage } = require("./_lib/whatsapp");
const { detectMarket } = require("./_lib/market");
const { checkEscalation, notifyMaddy } = require("./_lib/escalation");

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Mask a phone number for safe logging.
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  const str = String(phone);
  if (str.length <= 3) return "***";
  return "*".repeat(str.length - 3) + str.slice(-3);
}

/**
 * Normalise the inbound webhook payload.
 * AiSensy may send the fields at the top level OR nested under `data`.
 * @param {object} body - req.body from AiSensy
 * @returns {{ phone: string, message: string, name: string, timestamp: string }}
 */
function parsePayload(body) {
  const src = body && body.data ? body.data : body;
  return {
    phone: String(src.phone || "").trim(),
    message: String(src.message || "").trim(),
    name: String(src.name || "").trim(),
    timestamp: src.timestamp || new Date().toISOString(),
  };
}

/**
 * Log an inbound message to the messages table.
 */
async function logInboundMessage(supabase, phone, body) {
  const { error } = await supabase.from("messages").insert({
    phone,
    direction: "in",
    body,
    sent_at: new Date().toISOString(),
  });

  if (error) {
    console.error(
      `[webhook] Failed to log inbound message for ${maskPhone(phone)}:`,
      error.message
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Keyword matching for program interest                              */
/* ------------------------------------------------------------------ */

const PROGRAM_RULES = [
  {
    keywords: ["fat loss", "weight", "shred", "burn", "slim"],
    program_interest: "6wk_gym",
  },
  {
    keywords: ["pcos", "hormonal", "hormone"],
    program_interest: "pcos",
  },
  {
    keywords: ["40", "menopause", "joints", "joint", "age"],
    program_interest: "40plus",
  },
  {
    keywords: ["custom", "12 week", "serious", "flagship"],
    program_interest: "12wk",
  },
  {
    keywords: ["trial", "zoom", "not sure", "try"],
    program_interest: "zoom_trial",
  },
  {
    keywords: ["home", "no gym", "no equipment"],
    program_interest: "6wk_home",
  },
];

/**
 * Match a message to a program interest.
 * @param {string} text
 * @returns {string|null} program_interest or null if no match
 */
function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const rule of PROGRAM_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        return rule.program_interest;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Main handler                                                       */
/* ------------------------------------------------------------------ */

module.exports = async function handler(req, res) {
  // 1. Only accept POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let phone = "unknown";

  try {
    const supabase = getSupabase();
    const { phone: inPhone, message, name, timestamp } = parsePayload(req.body);
    phone = inPhone;

    if (!phone) {
      return res.status(400).json({ error: "Missing phone number" });
    }

    // 6. Log ALL inbound messages (fire-and-forget, but await to ensure it lands)
    await logInboundMessage(supabase, phone, message);

    // 3. Check for opt-out
    const OPT_OUT_RE = /\bstop\b|unsubscribe/i;
    if (OPT_OUT_RE.test(message)) {
      await supabase
        .from("leads")
        .update({ status: "dropped" })
        .eq("phone", phone);

      console.log(`[webhook] Opt-out recorded for ${maskPhone(phone)}`);
      return res.status(200).json({ status: "opted_out" });
    }

    // 4. Check for escalation triggers
    const { shouldEscalate, reason } = checkEscalation(message);
    if (shouldEscalate) {
      // Fire-and-forget: notify Maddy but don't block the flow
      notifyMaddy(reason, { phone, message }).catch((err) =>
        console.error(
          `[webhook] Escalation notification failed for ${maskPhone(phone)}:`,
          err.message
        )
      );
    }

    // 5. Look up existing lead
    const { data: existingLead, error: lookupError } = await supabase
      .from("leads")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();

    if (lookupError) {
      console.error(
        `[webhook] Lead lookup failed for ${maskPhone(phone)}:`,
        lookupError.message
      );
      return res.status(500).json({ error: "Lead lookup failed" });
    }

    /* ----- 5a. NEW lead (phone not in leads table) ----- */
    if (!existingLead) {
      const market = detectMarket(phone);

      const { error: insertError } = await supabase.from("leads").insert({
        phone,
        name: name || null,
        first_msg: message,
        status: "new",
        market,
        last_msg_at: new Date().toISOString(),
      });

      if (insertError) {
        console.error(
          `[webhook] Lead insert failed for ${maskPhone(phone)}:`,
          insertError.message
        );
        return res.status(500).json({ error: "Lead insert failed" });
      }

      // Send welcome template (no params)
      await sendWhatsApp(phone, "welcome_v1", []);

      console.log(`[webhook] New lead created: ${maskPhone(phone)} market=${market}`);
      return res.status(200).json({ status: "ok" });
    }

    /* ----- 5b. Existing lead, status = 'new' ----- */
    if (existingLead.status === "new") {
      const now = new Date().toISOString();
      const programInterest = matchProgram(message);

      if (programInterest) {
        // Qualify the lead
        const { error: updateError } = await supabase
          .from("leads")
          .update({
            status: "qualified",
            program_interest: programInterest,
            last_msg_at: now,
          })
          .eq("phone", phone);

        if (updateError) {
          console.error(
            `[webhook] Lead update failed for ${maskPhone(phone)}:`,
            updateError.message
          );
        }

        // Fetch the lead id for the intake form link
        const { data: updatedLead } = await supabase
          .from("leads")
          .select("id")
          .eq("phone", phone)
          .maybeSingle();

        const leadId = updatedLead ? updatedLead.id : existingLead.id;

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${programInterest}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${leadId}`;

        const text =
          `Great! Here's your checkout link:\n${checkoutUrl}\n\n` +
          `Please also fill out your intake form so we can personalise your plan:\n${intakeUrl}`;

        await sendTextMessage(phone, text);

        console.log(
          `[webhook] Lead qualified: ${maskPhone(phone)} program=${programInterest}`
        );
      } else {
        // No keyword match — ask for clarification
        await supabase
          .from("leads")
          .update({ last_msg_at: now })
          .eq("phone", phone);

        const clarification =
          "Thanks for reaching out! Could you tell me a bit more about your fitness goal? " +
          "For example: fat loss, home workout, PCOS management, or something else?";

        await sendTextMessage(phone, clarification);

        console.log(`[webhook] Clarification sent to ${maskPhone(phone)}`);
      }

      return res.status(200).json({ status: "ok" });
    }

    /* ----- 5c. Existing lead, status = 'qualified' or 'converted' ----- */
    if (existingLead.status === "qualified" || existingLead.status === "converted") {
      // Message already logged above (step 6)

      if (existingLead.status === "converted") {
        // Check if they are in the clients table and route to support
        const { data: client } = await supabase
          .from("clients")
          .select("id")
          .eq("phone", phone)
          .maybeSingle();

        if (client) {
          console.log(
            `[webhook] Converted client message from ${maskPhone(phone)} — routing to support`
          );
          // Support flow: for now, escalate to Maddy
          notifyMaddy("client_support", { phone, message }).catch((err) =>
            console.error(
              `[webhook] Support notification failed for ${maskPhone(phone)}:`,
              err.message
            )
          );
        }
      }

      return res.status(200).json({ status: "ok" });
    }

    // Any other status — just acknowledge
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error(
      `[webhook] Unhandled error for ${maskPhone(phone)}:`,
      err.message || err
    );
    return res.status(500).json({ error: "Internal server error" });
  }
};
