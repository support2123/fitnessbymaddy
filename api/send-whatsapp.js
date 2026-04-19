const { sendTemplate, sendText, sendMedia } = require('./lib/whatsapp');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, params, text, mediaUrl, caption } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone is required' });

    let result;
    switch (type) {
      case 'template':
        result = await sendTemplate(phone, templateName, params || []);
        break;
      case 'text':
        result = await sendText(phone, text);
        break;
      case 'media':
        result = await sendMedia(phone, mediaUrl, caption);
        break;
      default:
        return res.status(400).json({ error: 'type must be template, text, or media' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
