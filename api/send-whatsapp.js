const { sendTemplate, sendText } = require('../lib/whatsapp');
const { canSendMessage } = require('../lib/rate-limit');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY && authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, text, params, isClient } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone is required' });

  const allowed = await canSendMessage(phone, !!isClient);
  if (!allowed) {
    return res.status(429).json({
      error: 'Rate limited',
      detail: `Max 1 outbound per 2hrs for leads. Phone: ${maskPhone(phone)}`
    });
  }

  let result;
  if (type === 'template') {
    if (!templateName) return res.status(400).json({ error: 'templateName required for template type' });
    result = await sendTemplate(phone, templateName, params || {});
  } else {
    if (!text) return res.status(400).json({ error: 'text required for text type' });
    result = await sendText(phone, text);
  }

  return res.status(200).json({ ok: true, result });
};
