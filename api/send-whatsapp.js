const { sendTemplate, sendTextMessage } = require('./_lib/whatsapp');
const { handleCors } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendTextMessage(phone, text);
    } else {
      return res.status(400).json({ error: 'template or text required' });
    }

    return res.status(result.ok ? 200 : 429).json(result);

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
