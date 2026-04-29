const { sendTemplate, sendText, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, template, params, text, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    // Rate limit: 1 outbound per 2hrs unless force=true (for opted-in clients)
    if (!force) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — last message was < 2hrs ago' });
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
