const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');
const { normalizePhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, body_values, message, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const normalizedPhone = normalizePhone(phone);

    if (template_name) {
      const result = await sendWhatsApp({
        phone: normalizedPhone,
        templateName: template_name,
        bodyValues: body_values || [],
        mediaUrl: media_url || undefined,
      });
      return res.json(result);
    }

    if (message) {
      const result = await sendFreeformWhatsApp({
        phone: normalizedPhone,
        message,
      });
      return res.json(result);
    }

    return res.status(400).json({ error: 'template_name or message required' });

  } catch (err) {
    console.error('Send WhatsApp error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
