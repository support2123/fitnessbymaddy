const { sendWhatsApp, canSendMessage } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, body, params, forceOverrideRateLimit } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Missing phone' });
  }

  if (!forceOverrideRateLimit) {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
    }
  }

  try {
    const result = await sendWhatsApp({ phone, templateName, body, params });
    return res.status(200).json({ success: true, result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
