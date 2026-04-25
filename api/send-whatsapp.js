const { sendTemplate, sendText, checkRateLimit } = require("../lib/whatsapp");

/* ---------- helpers ---------- */

function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, 3) + "***" + phone.slice(-2);
}

function maskPII(text) {
  if (!text) return text;
  return text
    .replace(/\+?\d{10,15}/g, "***PHONE***")
    .replace(/[\w.-]+@[\w.-]+/g, "***EMAIL***");
}

/* ---------- handler ---------- */

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "https://fitnessbymaddy.com");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Internal-Key");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  /* ---- authenticate ---- */
  const internalKey = process.env.INTERNAL_API_KEY;
  const providedKey = req.headers["x-internal-key"];

  if (!internalKey) {
    console.error("send-whatsapp: INTERNAL_API_KEY not configured");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  if (!providedKey || providedKey !== internalKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { phone, template_name, params, message } = req.body || {};

    /* ---- validate input ---- */
    if (!phone) {
      return res.status(400).json({ error: "phone is required" });
    }

    if (!template_name && !message) {
      return res.status(400).json({
        error: "Either template_name or message is required",
      });
    }

    /* ---- rate limit check ---- */
    const withinLimit = await checkRateLimit(phone);
    if (!withinLimit) {
      console.warn(`Rate limit exceeded for ${maskPhone(phone)}`);
      return res.status(429).json({
        error: "Rate limit exceeded",
        detail: "Too many messages sent to this number recently",
      });
    }

    /* ---- send message ---- */
    let result;

    if (template_name) {
      result = await sendTemplate(phone, template_name, params || {});
    } else {
      result = await sendText(phone, message);
    }

    return res.status(200).json({
      success: true,
      ok: result.ok,
      data: result.data,
    });
  } catch (err) {
    console.error("send-whatsapp error:", maskPII(err.message));
    return res.status(500).json({ error: "Failed to send message" });
  }
};
