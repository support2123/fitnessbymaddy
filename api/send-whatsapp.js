const { sendTemplate, sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { phone, type, templateName, params, text } = req.body;

  if (!phone) return res.status(400).json({ error: 'missing phone' });

  try {
    let result;
    if (type === 'template' && templateName) {
      result = await sendTemplate(phone, templateName, params || {});
    } else if (type === 'text' && text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'specify type=template or type=text' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'send failed' });
  }
};
