const { sendTemplate, sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, params, message } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    let result;
    if (type === 'template') {
      if (!templateName) {
        return res.status(400).json({ error: 'templateName required for template messages' });
      }
      result = await sendTemplate(phone, templateName, params || []);
    } else {
      if (!message) {
        return res.status(400).json({ error: 'message required for text messages' });
      }
      result = await sendText(phone, message);
    }

    if (result.rateLimited) {
      return res.status(429).json({ error: 'Rate limited', phone });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('[send-whatsapp]', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
