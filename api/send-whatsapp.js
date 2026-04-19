const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, body_text } = req.body;

    if (!phone || !template_name) {
      return res.status(400).json({ error: 'phone and template_name required' });
    }

    const result = await sendWhatsApp(phone, template_name, params || {}, body_text || null);

    return res.status(200).json({
      ok: true,
      phone: maskPhone(phone),
      ...result
    });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
