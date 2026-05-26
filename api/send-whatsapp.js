const { sendTemplate, sendText } = require("./_lib/whatsapp");
const { canSendMessage } = require("./_lib/rate-limit");

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

/** Mask phone for safe logging. */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, -4).replace(/.(?=.{2})/g, "*").slice(0, -2) + phone.slice(-4, -2) + "**";
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    // Guard: internal use only
    if (INTERNAL_API_KEY) {
      const authHeader = req.headers["authorization"] || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
      if (token !== INTERNAL_API_KEY) {
        return res.status(401).json({ success: false, error: "unauthorized" });
      }
    }

    const { phone, template_name, message, params } = req.body || {};

    if (!phone) {
      return res.status(400).json({ success: false, error: "phone is required" });
    }

    if (!template_name && !message) {
      return res.status(400).json({ success: false, error: "template_name or message is required" });
    }

    // Rate limit check
    if (!canSendMessage(phone)) {
      console.warn(`[send-wa] Rate limited: ${maskPhone(phone)}`);
      return res.status(429).json({ success: false, error: "rate limited" });
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || {});
    } else {
      result = await sendText(phone, message);
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error(`[send-wa] Error:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
