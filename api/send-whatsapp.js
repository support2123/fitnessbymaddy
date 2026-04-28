const { sendTemplate, sendText, canSendMessage, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, type, template_name, params, message, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!force) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return res.status(429).json({
          error: 'Rate limited',
          detail: `Max 1 msg per 2hrs for ${maskPhone(phone)}`,
        });
      }
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'text' && message) {
      result = await sendText(phone, message);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template_name, or type=text with message' });
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
