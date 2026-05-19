const { sendWhatsApp } = require("../lib/whatsapp");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { phone, template_name, params } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: "Missing phone" });
    }

    if (!template_name) {
      return res.status(400).json({ error: "Missing template_name" });
    }

    const result = await sendWhatsApp(phone, template_name, params || {});

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error(`[send-whatsapp] Unhandled error: ${err.message}`);
    return res.status(500).json({ error: "Internal server error" });
  }
};
