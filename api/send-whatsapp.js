const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, bodyValues, mediaUrl } = req.body;

    if (!phone || !templateName) {
      return res.status(400).json({ error: 'phone and templateName are required' });
    }

    const result = await sendWhatsApp({ phone, templateName, bodyValues, mediaUrl });
    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('send-whatsapp error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
