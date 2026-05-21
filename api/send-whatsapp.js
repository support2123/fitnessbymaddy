const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { phone, templateName, bodyValues, mediaUrl, freeformMessage } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (freeformMessage) {
      result = await sendFreeformWhatsApp({ phone, message: freeformMessage });
    } else if (templateName) {
      result = await sendWhatsApp({ phone, templateName, bodyValues, mediaUrl });
    } else {
      return res.status(400).json({ error: 'templateName or freeformMessage required' });
    }

    return res.json(result);

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
