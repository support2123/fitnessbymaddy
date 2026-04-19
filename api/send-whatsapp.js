const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');
const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, body_values, message, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    let result;

    if (template_name) {
      result = await sendWhatsApp({
        phone,
        templateName: template_name,
        bodyValues: body_values || [],
        mediaUrl: media_url
      });
    } else if (message) {
      result = await sendFreeformWhatsApp({ phone, message });
    } else {
      return res.status(400).json({ error: 'template_name or message required' });
    }

    return res.status(result.ok ? 200 : 429).json(result);

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
