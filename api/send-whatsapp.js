const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const expectedKey = process.env.INTERNAL_API_KEY;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, body, params, isClient } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    if (!templateName && !body) {
      return res.status(400).json({ error: 'Missing templateName or body' });
    }

    const result = await sendWhatsApp({
      phone,
      templateName,
      body,
      params: params || [],
      isClient: isClient || false
    });

    return res.status(result.sent ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
