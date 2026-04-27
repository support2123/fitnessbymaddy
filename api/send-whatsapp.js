const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, mediaUrl } = req.body;

    if (!phone || !template) {
      return res.status(400).json({ error: 'phone and template required' });
    }

    const result = await sendWhatsApp(phone, template, params || [], mediaUrl);
    return res.json(result);
  } catch (err) {
    console.error('[send-whatsapp]', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
