const { sendTemplate, sendFreeform, canSendMessage, maskPhone } = require('./_lib/whatsapp');
const { cors } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const internalKey = req.headers['x-internal-key'];
  if (internalKey !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { phone, template, params, text } = req.body || {};

  if (!phone) return res.status(400).json({ error: 'missing phone' });

  const allowed = await canSendMessage(phone);
  if (!allowed) {
    return res.status(429).json({ error: 'rate_limited', phone: maskPhone(phone) });
  }

  let result;
  if (template) {
    result = await sendTemplate(phone, template, params || []);
  } else if (text) {
    result = await sendFreeform(phone, text);
  } else {
    return res.status(400).json({ error: 'missing template or text' });
  }

  return res.json(result);
};
