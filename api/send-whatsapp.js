const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, body, params } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Missing phone number' });
  }

  if (!templateName && !body) {
    return res.status(400).json({ error: 'Missing templateName or body' });
  }

  const result = await sendWhatsApp({ phone, templateName, body, params });
  return res.status(result.success ? 200 : 429).json(result);
};
