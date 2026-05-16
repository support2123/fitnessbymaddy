const { sendTemplate, sendTextMessage, normalizePhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const normalized = normalizePhone(phone);

    if (type === 'template') {
      if (!template_name) return res.status(400).json({ error: 'Missing template_name' });
      const result = await sendTemplate(normalized, template_name, params || []);
      return res.status(200).json(result);
    }

    if (type === 'text') {
      if (!text) return res.status(400).json({ error: 'Missing text' });
      const result = await sendTextMessage(normalized, text);
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Invalid type. Use "template" or "text"' });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
