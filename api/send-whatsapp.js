const { sendWhatsApp, sendTextMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, body, text_only } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    let result;
    if (text_only && body) {
      result = await sendTextMessage(phone, body);
    } else if (template_name) {
      result = await sendWhatsApp({ phone, templateName: template_name, params, body });
    } else {
      return res.status(400).json({ error: 'Provide template_name or text_only + body' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
