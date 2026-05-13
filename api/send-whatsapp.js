const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, body_values, message, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (template_name) {
      result = await sendWhatsApp(phone, template_name, body_values, media_url);
    } else if (message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'template_name or message required' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('[send-whatsapp]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
