const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params } = req.body;

    if (!phone || !template) {
      return res.status(400).json({ error: 'Missing phone or template' });
    }

    const result = await sendWhatsApp(phone, template, params || {});

    if (result.rateLimited) {
      return res.status(429).json({ error: 'Rate limited', phone: maskPhone(phone) });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
