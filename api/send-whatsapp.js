const { sendTemplate, sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const authHeader = req.headers.authorization || '';
    if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, type, template_name, text, params } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || {});
    } else if (type === 'text' && text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template_name, or type=text with text' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
