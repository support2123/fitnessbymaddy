const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params } = req.body;

  if (!phone || !template) {
    return res.status(400).json({ error: 'Missing phone or template' });
  }

  const result = await sendWhatsApp(phone, template, params || {});

  if (result.rateLimited) {
    return res.status(429).json({ error: 'Rate limited', message: 'Max 1 msg per 2hrs for non-clients' });
  }

  return res.status(200).json({ success: true, result });
};
