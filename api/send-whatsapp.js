const { sendTemplate, sendText, sendMediaMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, template, params, text, mediaUrl, caption } = req.body;

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  try {
    let result;
    if (type === 'template' && template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (type === 'media' && mediaUrl) {
      result = await sendMediaMessage(phone, mediaUrl, caption);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template+params, text, or mediaUrl' });
    }

    return res.json(result);
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
