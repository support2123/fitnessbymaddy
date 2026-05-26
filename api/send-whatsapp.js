const { sendTemplate, sendFreeformMessage, canSendMessage, normalizePhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, message } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const normalized = normalizePhone(phone);
    const allowed = await canSendMessage(normalized);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours' });
    }

    let result;
    if (template_name) {
      result = await sendTemplate(normalized, template_name, params || []);
    } else if (message) {
      result = await sendFreeformMessage(normalized, message);
    } else {
      return res.status(400).json({ error: 'Provide template_name or message' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
