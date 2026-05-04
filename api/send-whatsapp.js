const { sendWhatsApp, sendFreeformWhatsApp, sendWhatsAppMedia } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, message, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;

    if (media_url && template_name) {
      result = await sendWhatsAppMedia(phone, template_name, media_url, params || []);
    } else if (template_name) {
      result = await sendWhatsApp(phone, template_name, params || []);
    } else if (message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'template_name or message required' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
