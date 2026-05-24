const { sendTemplate, sendText } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, text } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'template_name or text required' });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
