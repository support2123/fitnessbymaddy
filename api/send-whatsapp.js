const { sendWhatsApp, sendWhatsAppUnlimited } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, body, params, unlimited } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const sender = unlimited ? sendWhatsAppUnlimited : sendWhatsApp;
    const result = await sender({ phone, templateName, body, params });

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
