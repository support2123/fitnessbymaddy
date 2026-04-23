const { sendTemplate, sendText, checkRateLimit, logMessage } = require("./_lib/whatsapp");
const { supabase } = require("./_lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { phone, message, templateName, templateParams } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: "Missing phone" });
    }

    if (!templateName && !message) {
      return res.status(400).json({ error: "Missing message or templateName" });
    }

    // Check if sender is an active client (active clients bypass rate limit)
    const { data: clientRow } = await supabase
      .from("clients")
      .select("id, status")
      .eq("phone", phone)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    const isActiveClient = !!clientRow;

    // Check rate limit — active clients bypass it
    if (!isActiveClient) {
      const limited = await checkRateLimit(phone);
      if (limited) {
        return res.status(429).json({ error: "Rate limited" });
      }
    }

    // Send the message
    if (templateName) {
      await sendTemplate(phone, templateName, templateParams || []);
      await logMessage(phone, "outbound", `[template: ${templateName}]`, templateName);
    } else {
      await sendText(phone, message);
      await logMessage(phone, "outbound", message, null);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(`[send-whatsapp] Error: ${err.message}`);
    return res.status(500).json({ error: "Internal server error" });
  }
};
