const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, body, templateName } = req.body;
  if (!phone) return res.status(400).json({ error: 'Missing phone' });
  if (!body && !templateName) return res.status(400).json({ error: 'Missing body or templateName' });

  try {
    const result = await sendWhatsApp(phone, body, templateName);
    if (result.rateLimited) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours' });
    }
    return res.status(200).json({ ok: true, phone: maskPhone(phone) });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
