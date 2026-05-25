const { sendWhatsApp, sendWhatsAppText } = require("./_lib/whatsapp");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const { phone, template, params, text } = body;

    if (!phone) {
      return res.status(400).json({ error: "phone is required" });
    }

    if (!template && !text) {
      return res.status(400).json({
        error: "Either template (with optional params) or text is required",
      });
    }

    let result;

    if (template) {
      // Send a template message
      result = await sendWhatsApp(phone, template, params || []);
    } else {
      // Send a free-form text message
      result = await sendWhatsAppText(phone, text);
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error("[send-whatsapp] Error:", err.message);
    return res.status(500).json({ error: "Failed to send message" });
  }
};
