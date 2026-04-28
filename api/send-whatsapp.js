const { sendTemplate, sendTextMessage, canSendToLead } = require('./lib/whatsapp');
const { jsonResponse, errorResponse } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, text, params, skipRateLimit } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' });
  }

  if (!skipRateLimit) {
    const allowed = await canSendToLead(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for leads' });
    }
  }

  let result;
  if (type === 'template' && templateName) {
    result = await sendTemplate(phone, templateName, params || {});
  } else if (type === 'text' && text) {
    result = await sendTextMessage(phone, text);
  } else {
    return res.status(400).json({ error: 'Provide type=template with templateName, or type=text with text' });
  }

  return res.status(200).json({ ok: true, result });
};
