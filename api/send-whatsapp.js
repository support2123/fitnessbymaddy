const { supabase } = require("./_lib/supabase");
const { sendTemplate, sendText } = require("./_lib/whatsapp");
const { respond, parseBody } = require("./_lib/helpers");

/* ── Auth check ────────────────────────────────────────────────── */

function isAuthorized(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return token && token === process.env.INTERNAL_API_KEY;
}

/* ── Log an outbound message ───────────────────────────────────── */

async function logMessage(phone, body) {
  const { error } = await supabase
    .from("messages")
    .insert({ phone, direction: "out", body, sent_at: new Date().toISOString() });

  if (error) console.error("logMessage error:", error.message);
}

/* ── Main handler ──────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  // Preflight
  if (req.method === "OPTIONS") {
    return respond(res, 204, null);
  }

  if (req.method !== "POST") {
    return respond(res, 405, { error: "Method not allowed" });
  }

  // Authorization
  if (!isAuthorized(req)) {
    return respond(res, 401, { error: "Unauthorized" });
  }

  try {
    const body = await parseBody(req);
    const { phone, template, params, text, isClient } = body;

    if (!phone) {
      return respond(res, 400, { error: "phone is required" });
    }

    if (!template && !text) {
      return respond(res, 400, { error: "Either template or text is required" });
    }

    const opts = { isClient: !!isClient };
    let result;
    let logBody;

    if (template) {
      result = await sendTemplate(phone, template, params || [], opts);
      logBody = `[template: ${template}]${params ? " params=" + JSON.stringify(params) : ""}`;
    } else {
      result = await sendText(phone, text, opts);
      logBody = text;
    }

    // Log outbound message (unless rate-limited / skipped)
    if (!result.skipped) {
      await logMessage(phone, logBody);
    }

    return respond(res, 200, {
      status: "ok",
      result,
    });
  } catch (err) {
    console.error("send-whatsapp error:", err);
    return respond(res, 500, { error: err.message });
  }
};
