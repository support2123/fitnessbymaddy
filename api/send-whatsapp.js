const { sendWhatsApp, sendFreeformWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, bodyValues, message, mediaUrl } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (templateName) {
      result = await sendWhatsApp({ phone, templateName, bodyValues, mediaUrl });
    } else if (message) {
      result = await sendFreeformWhatsApp({ phone, message });
    } else {
      return res.status(400).json({ error: 'templateName or message required' });
    }

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
