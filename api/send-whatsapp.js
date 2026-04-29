const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, bodyValues, mediaUrl } = req.body;
  if (!phone || !template) {
    return res.status(400).json({ error: 'phone and template required' });
  }

  const result = await sendWhatsApp(phone, template, bodyValues, mediaUrl);
  return res.status(result.sent ? 200 : 429).json(result);
};
