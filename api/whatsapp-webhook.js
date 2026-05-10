const { query, insert, update } = require("./lib/supabase");
const { sendTemplate, maskPhone, markOptedIn } = require("./lib/whatsapp");
const { detectMarket, detectProgram, needsEscalation, jsonResponse, errorResponse } = require("./lib/utils");

const MADDY_PHONE = process.env.MADDY_PHONE || "+917082478374";
const STOP_KEYWORDS = ["stop", "unsubscribe"];

/**
 * Log an inbound or outbound message to the messages table.
 */
async function logMessage(phone, direction, body, templateName) {
  try {
    await insert("messages", {
      phone,
      direction,
      body: body || null,
      template_name: templateName || null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[logMessage] Failed for ${maskPhone(phone)}: ${err.message}`);
  }
}

/**
 * Handle a brand-new lead: insert, detect market, send welcome.
 */
async function handleNewLead(phone, name, message) {
  const market = detectMarket(phone);
  const [lead] = await insert("leads", {
    phone,
    name: name || null,
    status: "new",
    market,
    source: "whatsapp",
    first_msg: (message || "").slice(0, 500) || null,
    last_msg_at: new Date().toISOString(),
  });

  markOptedIn(phone);
  await sendTemplate(phone, "welcome_v1", [name || "there"]);
  await logMessage(phone, "out", null, "welcome_v1");

  return lead;
}

/**
 * Handle an existing lead with status=new: try to detect program interest.
 */
async function handleNewStatusLead(phone, lead, message) {
  const program = detectProgram(message);

  if (program) {
    await update("leads", { phone: `eq.${phone}` }, {
      program_interest: program.slug,
      status: "qualified",
    });
    await sendTemplate(phone, "checkout_link", [
      lead.name || "there",
      program.slug,
      program.checkout_url,
    ]);
    await logMessage(phone, "out", null, "checkout_link");
  } else {
    await sendTemplate(phone, "program_help", [lead.name || "there"]);
    await logMessage(phone, "out", null, "program_help");
  }
}

/**
 * Handle an existing lead with status=qualified: remind about checkout.
 */
async function handleQualifiedLead(phone, lead) {
  await sendTemplate(phone, "checkout_link", [
    lead.name || "there",
    lead.program_interest || "your program",
  ]);
  await logMessage(phone, "out", null, "checkout_link");
}

module.exports = async function handler(req, res) {
  // ---------- GET: webhook verification ----------
  if (req.method === "GET") {
    const challenge = req.query["hub.challenge"] || req.query.challenge;
    if (challenge) {
      return res.status(200).send(challenge);
    }
    return jsonResponse(res, { status: "ok" });
  }

  // ---------- POST: incoming message ----------
  if (req.method !== "POST") {
    return errorResponse(res, "Method not allowed", 405);
  }

  let phone, message, name;

  try {
    const body = req.body || {};
    phone = body.mobile || body.phone || body.from;
    message = body.message || body.text || "";
    name = body.name || body.userName || null;

    if (!phone) {
      return errorResponse(res, "Missing phone number", 400);
    }

    // Normalize phone: ensure + prefix
    if (!phone.startsWith("+")) {
      phone = `+${phone}`;
    }

    // Log inbound message
    await logMessage(phone, "in", message, null);

    // ---- STOP / unsubscribe ----
    if (STOP_KEYWORDS.includes((message || "").trim().toLowerCase())) {
      await update("leads", { phone: `eq.${phone}` }, {
        status: "dropped",
      });
      console.log(`[whatsapp-webhook] Opt-out processed for ${maskPhone(phone)}`);
      return jsonResponse(res, { status: "opted_out" });
    }

    // ---- Escalation check ----
    if (needsEscalation(message)) {
      try {
        await sendTemplate(MADDY_PHONE, "escalation_alert", [
          maskPhone(phone),
          message.slice(0, 200),
        ]);
        console.log(`[whatsapp-webhook] Escalation sent for ${maskPhone(phone)}`);
      } catch (escErr) {
        console.error(`[whatsapp-webhook] Escalation send failed: ${escErr.message}`);
      }
      // Continue processing normally after escalation
    }

    // ---- Look up lead ----
    const leads = await query("leads", {
      filters: { phone: `eq.${phone}` },
      limit: 1,
    });

    const existingLead = leads && leads.length > 0 ? leads[0] : null;

    if (!existingLead) {
      // New lead
      await handleNewLead(phone, name, message);
      return jsonResponse(res, { status: "new_lead" });
    }

    // ---- Existing lead routing ----
    const { status } = existingLead;

    if (status === "dropped") {
      // Never message a dropped lead again
      console.log(`[whatsapp-webhook] Ignoring message from dropped lead ${maskPhone(phone)}`);
      return jsonResponse(res, { status: "dropped_ignored" });
    }

    if (status === "new") {
      await handleNewStatusLead(phone, existingLead, message);
      return jsonResponse(res, { status: "processed" });
    }

    if (status === "qualified") {
      await handleQualifiedLead(phone, existingLead);
      return jsonResponse(res, { status: "checkout_reminder" });
    }

    if (status === "converted") {
      // Existing client - log for client support (future implementation)
      console.log(`[whatsapp-webhook] Client message from ${maskPhone(phone)}: ${message.slice(0, 100)}`);
      return jsonResponse(res, { status: "client_logged" });
    }

    // Fallback for any other status
    console.log(`[whatsapp-webhook] Unhandled status '${status}' for ${maskPhone(phone)}`);
    return jsonResponse(res, { status: "unhandled" });

  } catch (err) {
    const safePhone = phone ? maskPhone(phone) : "unknown";
    console.error(`[whatsapp-webhook] Error for ${safePhone}: ${err.message}`);
    return errorResponse(res, "Internal server error", 500);
  }
}
