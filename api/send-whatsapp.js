const { sendTemplate, sendText } = require("../lib/whatsapp");
const { maskPhone } = require("../lib/helpers");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // --- Auth check: internal API key ---
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { phone, template_name, text, params } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: "Missing phone" });
    }
    if (!template_name && !text) {
      return res
        .status(400)
        .json({ error: "Provide either template_name or text" });
    }

    const masked = maskPhone(phone);
    let result;

    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
      console.log(
        `[send-whatsapp] Template "${template_name}" sent to ${masked}: ok=${result.ok}`
      );
    } else {
      result = await sendText(phone, text);
      console.log(
        `[send-whatsapp] Text sent to ${masked}: ok=${result.ok}`
      );
    }

    return res.status(200).json({
      success: result.ok,
      data: result.data,
    });
  } catch (err) {
    console.error("[send-whatsapp] Unhandled error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
