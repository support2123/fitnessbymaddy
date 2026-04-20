const { sendTemplate, sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, template, params, message, mediaUrl } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' });
  }

  try {
    let result;
    if (type === 'template') {
      if (!template) {
        return res.status(400).json({ error: 'template is required for type=template' });
      }
      result = await sendTemplate(phone, template, params || [], mediaUrl || null);
    } else {
      if (!message) {
        return res.status(400).json({ error: 'message is required for type=text' });
      }
      result = await sendText(phone, message);
    }

    if (!result.ok) {
      return res.status(429).json({ error: result.error || 'Send failed' });
    }

    return res.status(200).json({ ok: true, data: result.data });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
