const { sendWhatsApp, canSendToLead } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, bodyValues, mediaUrl, isClient } = req.body;

    if (!phone || !templateName) {
      return res.status(400).json({ error: 'phone and templateName required' });
    }

    if (!isClient) {
      const canSend = await canSendToLead(phone);
      if (!canSend) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
      }
    }

    const result = await sendWhatsApp({ phone, templateName, bodyValues, mediaUrl });
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
