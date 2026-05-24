const { canSendMessage, sendTemplate, sendTextMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, params, text, forceOverrideRateLimit } = req.body;

  if (!phone) return res.status(400).json({ error: 'Phone required' });

  if (!forceOverrideRateLimit) {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for leads' });
    }
  }

  try {
    if (type === 'template') {
      const result = await sendTemplate(phone, templateName, params || []);
      return res.status(200).json({ sent: true, result });
    }

    if (type === 'text') {
      const ok = await sendTextMessage(phone, text);
      return res.status(200).json({ sent: ok });
    }

    return res.status(400).json({ error: 'type must be "template" or "text"' });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
