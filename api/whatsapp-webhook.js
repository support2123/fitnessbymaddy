const { supabase } = require("./_lib/supabase");
const { sendTemplate, sendText, notifyMaddy } = require("./_lib/whatsapp");
const { detectMarket } = require("./_lib/market");
const { checkEscalation } = require("./_lib/escalation");
const { maskPhone, respond, parseBody } = require("./_lib/helpers");

/* ── Program routing keywords ─────────────────────────────────── */
const PROGRAM_ROUTES = [
  { keys: ["fat loss", "weight", "shred", "lose"], program: "6wk_gym", label: "6-Week Burn & Build" },
  { keys: ["pcos", "hormonal", "hormone"], program: "pcos", label: "PCOS Warrior" },
  { keys: ["40", "menopause", "joints", "joint"], program: "40plus", label: "40+ Strong" },
  { keys: ["custom", "12 week", "serious", "12wk"], program: "12wk", label: "12-Week Flagship" },
  { keys: ["trial", "zoom", "not sure", "try"], program: "zoom_trial", label: "Zoom Trial" },
  { keys: ["home", "no gym", "bodyweight"], program: "6wk_home", label: "6-Week Home" },
];

/* ── Helpers ───────────────────────────────────────────────────── */

function normalizePhone(raw) {
  if (!raw) return "";
  let phone = String(raw).replace(/[\s\-()]/g, "");
  if (!phone.startsWith("+")) {
    // Assume Indian number if no country code
    phone = phone.startsWith("91") ? `+${phone}` : `+91${phone}`;
  }
  return phone;
}

function isOptOut(text) {
  const lower = (text || "").toLowerCase().trim();
  return lower === "stop" || lower.includes("unsubscribe");
}

function matchProgram(text) {
  const lower = (text || "").toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    for (const keyword of route.keys) {
      if (lower.includes(keyword)) {
        return route;
      }
    }
  }
  return null;
}

/* ── Log a message row ─────────────────────────────────────────── */

async function logMessage(phone, direction, body) {
  const { error } = await supabase
    .from("messages")
    .insert({ phone, direction, body, sent_at: new Date().toISOString() });

  if (error) console.error("logMessage error:", error.message);
}

/* ── Main handler ──────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  // Preflight
  if (req.method === "OPTIONS") {
    return respond(res, 204, null);
  }

  // Webhook verification (GET)
  if (req.method === "GET") {
    return respond(res, 200, { status: "ok" });
  }

  if (req.method !== "POST") {
    return respond(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = await parseBody(req);

    // Flexible field names from AiSensy payloads
    const rawPhone = body.phone || body.senderPhone || body.from || "";
    const messageText = body.message || body.text || body.body || "";
    const senderName = body.name || body.senderName || body.pushName || "";

    const phone = normalizePhone(rawPhone);
    if (!phone) {
      return respond(res, 200, { status: "ignored", reason: "no_phone" });
    }

    // 1. Log inbound message
    await logMessage(phone, "in", messageText);

    // 2. Opt-out check
    if (isOptOut(messageText)) {
      await supabase
        .from("leads")
        .update({ status: "dropped" })
        .eq("phone", phone);

      console.log(`Opt-out processed for ${maskPhone(phone)}`);
      return respond(res, 200, { status: "opt_out" });
    }

    // 3. Escalation check
    const escalation = checkEscalation(messageText);
    if (escalation.shouldEscalate) {
      await notifyMaddy(
        `⚠️ Escalation — trigger "${escalation.reason}" from ${maskPhone(phone)}:\n"${messageText}"`
      );
    }

    // 4. Lead lookup
    const { data: existingLead, error: lookupErr } = await supabase
      .from("leads")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();

    if (lookupErr) {
      console.error("Lead lookup error:", lookupErr.message);
      return respond(res, 200, { status: "error", detail: "db_lookup" });
    }

    /* ── New lead ─────────────────────────────────────────────── */
    if (!existingLead) {
      const market = detectMarket(phone);

      const { error: insertErr } = await supabase.from("leads").insert({
        phone,
        name: senderName || null,
        status: "new",
        source: "whatsapp",
        first_msg: messageText,
        market,
        created_at: new Date().toISOString(),
      });

      if (insertErr) {
        console.error("Lead insert error:", insertErr.message);
      }

      // Send welcome template
      await sendTemplate(phone, "welcome_v1", [senderName || "there"]);
      await logMessage(phone, "out", "[template: welcome_v1]");

      return respond(res, 200, { status: "new_lead" });
    }

    /* ── Dropped lead — never message again ───────────────────── */
    if (existingLead.status === "dropped") {
      return respond(res, 200, { status: "ignored", reason: "dropped" });
    }

    /* ── Qualified / converted — just log, no auto-reply ──────── */
    if (existingLead.status === "qualified" || existingLead.status === "converted") {
      return respond(res, 200, { status: "logged" });
    }

    /* ── Status = 'new' — attempt keyword qualification ───────── */
    if (existingLead.status === "new") {
      const matched = matchProgram(messageText);

      if (matched) {
        await supabase
          .from("leads")
          .update({
            program_interest: matched.program,
            status: "qualified",
          })
          .eq("phone", phone);

        // Send checkout link + intake form
        const checkoutUrl = `${process.env.BASE_URL || "https://fitnessbymaddy.com"}/checkout/${matched.program}`;
        const intakeUrl = `${process.env.BASE_URL || "https://fitnessbymaddy.com"}/intake?lead=${existingLead.id}`;

        const qualMsg =
          `Great choice! You're a perfect fit for *${matched.label}*.\n\n` +
          `🔗 Checkout: ${checkoutUrl}\n` +
          `📋 Quick intake form: ${intakeUrl}\n\n` +
          `Fill out the form so Maddy can personalise your plan!`;

        await sendText(phone, qualMsg);
        await logMessage(phone, "out", qualMsg);

        return respond(res, 200, { status: "qualified", program: matched.program });
      }

      // No keyword match — ask for clarification
      const clarifyMsg =
        "Thanks for reaching out! Could you tell me a bit more about your fitness goal?\n\n" +
        "For example:\n" +
        "• Fat loss / shred\n" +
        "• PCOS / hormonal support\n" +
        "• 40+ / joint-friendly\n" +
        "• Home workouts (no gym)\n" +
        "• 12-week custom program\n" +
        "• Trial session on Zoom";

      await sendText(phone, clarifyMsg);
      await logMessage(phone, "out", clarifyMsg);

      return respond(res, 200, { status: "clarification_sent" });
    }

    // Fallback for any other status — just log
    return respond(res, 200, { status: "logged" });
  } catch (err) {
    console.error("whatsapp-webhook error:", err);
    // Always return 200 so the webhook provider doesn't retry endlessly
    return respond(res, 200, { status: "error", detail: err.message });
  }
};
