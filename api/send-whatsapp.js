const { sendWhatsApp, sendWhatsAppDirect } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, body, params, skipRateLimit } = req.body;

    if (!phone || !templateName) {
      return res.status(400).json({ error: 'Missing phone or templateName' });
    }

    const result = skipRateLimit
      ? await sendWhatsAppDirect({ phone, templateName, body, params })
      : await sendWhatsApp({ phone, templateName, body, params });

    return res.status(200).json({
      ...result,
      phone: maskPhone(phone)
    });

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
