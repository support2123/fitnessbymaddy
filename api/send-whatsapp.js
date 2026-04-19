const { sendTemplate, sendSession, canSendMessage } = require("../lib/whatsapp");
const { cors, maskPhone } = require("../lib/utils");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { phone, type, templateName, params, text, mediaUrl } = req.body;

    if (!phone) return res.status(400).json({ error: "phone required" });

    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({
        error: "Rate limited — max 1 message per 2 hours for non-clients",
        phone: maskPhone(phone),
      });
    }

    let result;
    if (type === "template") {
      if (!templateName) return res.status(400).json({ error: "templateName required" });
      result = await sendTemplate(phone, templateName, params || [], mediaUrl);
    } else {
      if (!text) return res.status(400).json({ error: "text required" });
      result = await sendSession(phone, text);
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error("send-whatsapp error:", err.message);
    return res.status(500).json({ error: "Failed to send" });
  }
};
