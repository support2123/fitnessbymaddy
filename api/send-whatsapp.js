const { sendTemplate, sendTextMessage, canSendMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, params, text } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  try {
    let result;
    if (type === 'template') {
      if (!templateName) return res.status(400).json({ error: 'templateName required' });
      result = await sendTemplate(phone, templateName, params || []);
    } else {
      if (!text) return res.status(400).json({ error: 'text required' });
      result = await sendTextMessage(phone, text);
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
