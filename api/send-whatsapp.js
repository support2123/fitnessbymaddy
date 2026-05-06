const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, body, params } = req.body;

    if (!phone || !templateName) {
      return res.status(400).json({ error: 'phone and templateName are required' });
    }

    const result = await sendWhatsApp({ phone, templateName, body, params });

    if (result.rateLimited) {
      return res.status(429).json({ error: 'Rate limited', message: 'Max 1 message per 2 hours for non-clients' });
    }

    if (result.dropped) {
      return res.status(200).json({ skipped: true, reason: 'Lead opted out' });
    }

    return res.status(200).json({ success: result.sent, result: result.result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
