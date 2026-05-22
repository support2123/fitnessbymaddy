const { sendTemplate, sendTextMessage, canSendMessage, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, force } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    if (!force) {
      const allowed = await canSendMessage(phone, false);
      if (!allowed) {
        return res.status(429).json({
          error: 'Rate limited',
          phone: maskPhone(phone)
        });
      }
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || {});
    } else if (type === 'text' && text) {
      result = await sendTextMessage(phone, text);
    } else {
      return res.status(400).json({ error: 'Specify type=template with template_name, or type=text with text' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
