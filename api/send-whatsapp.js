const { sendTemplate, sendText, sendMediaMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, params, text, mediaUrl, caption } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;

    if (type === 'template') {
      result = await sendTemplate(phone, templateName, params || []);
    } else if (type === 'media') {
      result = await sendMediaMessage(phone, mediaUrl, caption);
    } else {
      result = await sendText(phone, text || '');
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
