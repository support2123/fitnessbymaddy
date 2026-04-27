const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, body_values, media_url, freeform_message } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    if (freeform_message) {
      const ok = await sendFreeformWhatsApp(phone, freeform_message);
      return res.status(200).json({ success: ok });
    }

    if (!template_name) return res.status(400).json({ error: 'template_name required' });

    const result = await sendWhatsApp(phone, template_name, body_values, media_url);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
