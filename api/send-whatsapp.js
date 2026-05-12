const { sendWhatsApp, sendTextMessage, canSendMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-api-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, text, skipRateLimit } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone required' });
  }

  if (!skipRateLimit) {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited' });
    }
  }

  let result;
  if (text) {
    result = await sendTextMessage(phone, text);
  } else if (template) {
    result = await sendWhatsApp(phone, template, params || {}, !!skipRateLimit);
  } else {
    return res.status(400).json({ error: 'Provide template or text' });
  }

  return res.status(result.ok ? 200 : 500).json(result);
};
