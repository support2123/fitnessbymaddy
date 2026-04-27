const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/pii');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-api-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, body, templateName } = req.body;
  if (!phone || !body) {
    return res.status(400).json({ error: 'Missing phone or body' });
  }

  try {
    const result = await sendWhatsApp(phone, body, templateName || null);
    if (result.rateLimited) {
      return res.status(429).json({ error: 'Rate limited: max 1 msg per 2hrs for non-clients' });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('Send error:', maskPhone(phone), err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
