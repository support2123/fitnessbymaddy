const { sendTemplate, sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, params, text, isClient } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (type === 'template') {
      if (!templateName) return res.status(400).json({ error: 'templateName required' });
      result = await sendTemplate(phone, templateName, params || [], !!isClient);
    } else {
      if (!text) return res.status(400).json({ error: 'text required' });
      result = await sendText(phone, text);
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
