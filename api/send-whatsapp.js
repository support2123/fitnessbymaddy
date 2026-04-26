const { sendTemplate, sendText } = require("./lib/whatsapp");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://fitnessbymaddy.com");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const apiKey = process.env.INTERNAL_API_KEY;
    const authHeader = req.headers["authorization"] || "";

    if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { phone, template_name, body, params } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: "Missing required field: phone" });
    }

    if (!template_name && !body) {
      return res.status(400).json({ error: "Provide template_name or body" });
    }

    let result;

    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else {
      result = await sendText(phone, body);
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("send-whatsapp error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
