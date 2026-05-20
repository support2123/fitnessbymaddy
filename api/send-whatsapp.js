const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');
const { cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, message, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (template_name) {
      result = await sendWhatsApp(phone, template_name, params || [], media_url || null);
    } else if (message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'Provide template_name or message' });
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
