const { normalizePhone, sendWhatsApp, maskPhone } = require("./lib/whatsapp");
const { logMessage, canSendMessage } = require("./lib/messages");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { phone, template, params, force } = req.body;
  if (!phone || !template) {
    return res.status(400).json({ error: "phone and template required" });
  }

  const normalized = normalizePhone(phone);

  if (!force && !(await canSendMessage(normalized))) {
    return res.status(429).json({
      error: "Rate limited — max 1 message per 2 hours for non-clients",
      phone: maskPhone(normalized),
    });
  }

  try {
    const result = await sendWhatsApp(normalized, template, params || {});
    await logMessage(normalized, "out", `Template: ${template}`, template);
    return res.json({ ok: true, result: result.data });
  } catch (err) {
    console.error("[SEND-WA]", err.message);
    return res.status(500).json({ error: "Failed to send" });
  }
};
