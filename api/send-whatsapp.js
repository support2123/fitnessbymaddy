const { sendTemplate, sendText, sendMedia, canSend } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, params, text, mediaUrl, caption, isClient } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    const allowed = await canSend(phone, isClient || false);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for non-clients' });
    }

    let result;

    if (type === 'template') {
      result = await sendTemplate(phone, templateName, params || []);
    } else if (type === 'text') {
      result = await sendText(phone, text);
    } else if (type === 'media') {
      result = await sendMedia(phone, mediaUrl, caption);
    } else {
      return res.status(400).json({ error: 'Invalid type. Use: template, text, or media' });
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
