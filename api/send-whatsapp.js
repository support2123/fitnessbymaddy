const { sendTemplate, sendTextMessage, canSendMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, text, params, isClient } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    let result;

    if (type === 'template' && templateName) {
      result = await sendTemplate(phone, templateName, params || {});
    } else if (type === 'text' && text) {
      result = await sendTextMessage(phone, text, isClient || false);
    } else {
      return res.status(400).json({ error: 'Specify type=template with templateName, or type=text with text' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
