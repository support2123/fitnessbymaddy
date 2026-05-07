const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, bodyValues, mediaUrl } = req.body;
  if (!phone || !templateName) {
    return res.status(400).json({ error: 'phone and templateName required' });
  }

  const result = await sendWhatsApp({ phone, templateName, bodyValues, mediaUrl });
  return res.status(result.ok ? 200 : 429).json(result);
};
