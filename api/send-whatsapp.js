const { sendWhatsApp, sendFreeformWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, bodyValues, mediaUrl, freeformMessage } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone is required' });

    if (freeformMessage) {
      const result = await sendFreeformWhatsApp({ phone, message: freeformMessage });
      return res.status(200).json(result);
    }

    if (!templateName) return res.status(400).json({ error: 'templateName is required' });

    const result = await sendWhatsApp({ phone, templateName, bodyValues, mediaUrl });
    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
