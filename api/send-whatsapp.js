const { sendTemplate, sendFreeform, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, template_name, params, message, force } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!force) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited: max 1 message per 2 hours' });
      }
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (message) {
      result = await sendFreeform(phone, message);
    } else {
      return res.status(400).json({ error: 'template_name or message required' });
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
