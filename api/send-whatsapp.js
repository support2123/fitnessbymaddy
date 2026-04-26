const { sendTemplate, sendSession, sendMediaMessage, canSendMessage } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, params, message, mediaUrl, caption } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({
        error: 'Rate limited',
        detail: `Cannot send to ${maskPhone(phone)} — last message within 2 hours`
      });
    }

    let result;
    switch (type) {
      case 'template':
        result = await sendTemplate(phone, templateName, params || []);
        break;
      case 'session':
        result = await sendSession(phone, message);
        break;
      case 'media':
        result = await sendMediaMessage(phone, mediaUrl, caption);
        break;
      default:
        return res.status(400).json({ error: 'Invalid type. Use: template, session, media' });
    }

    return res.status(200).json({ success: true, result });

  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
