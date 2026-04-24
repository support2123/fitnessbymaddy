const { sendTemplate, sendText, canSendToLead } = require('../lib/whatsapp');

// Internal helper endpoint — rate-limited WhatsApp sender
// Expects: { phone, template?, params?, text?, mediaUrl?, skipRateLimit? }
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, text, mediaUrl, skipRateLimit } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' });
  }

  if (!skipRateLimit) {
    const canSend = await canSendToLead(phone);
    if (!canSend) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for leads' });
    }
  }

  try {
    let result;
    if (template) {
      result = await sendTemplate(phone, template, params, mediaUrl);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'template or text is required' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
