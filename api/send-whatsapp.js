const { sendTemplate, sendText, checkRateLimit } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!force) {
      const canSend = await checkRateLimit(phone);
      if (!canSend) {
        return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours' });
      }
    }

    let result;
    if (type === 'template') {
      if (!template_name) return res.status(400).json({ error: 'template_name required' });
      result = await sendTemplate(phone, template_name, params || []);
    } else {
      if (!text) return res.status(400).json({ error: 'text required' });
      result = await sendText(phone, text);
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
