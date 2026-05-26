const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, body, templateName } = req.body;

  if (!phone || !body) {
    return res.status(400).json({ error: 'Missing phone or body' });
  }

  const result = await sendWhatsApp(phone, body, templateName || null);
  return res.status(result.ok ? 200 : 429).json(result);
};
