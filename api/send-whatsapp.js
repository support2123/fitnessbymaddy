const { sendTemplate, sendText, canSendMessage, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, template, params, text, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!force) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return res.status(429).json({
          error: 'Rate limited: max 1 message per 2 hours for non-opted-in contacts',
          phone: maskPhone(phone)
        });
      }
    }

    if (template) {
      const result = await sendTemplate(phone, template, params || []);
      return res.json({ success: true, result });
    }

    if (text) {
      await sendText(phone, text);
      return res.json({ success: true });
    }

    return res.status(400).json({ error: 'template or text required' });

  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
