const { sendTemplate, sendFreeform } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, text, isClient } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });

  let result;
  if (template) {
    result = await sendTemplate(phone, template, params || [], !!isClient);
  } else if (text) {
    result = await sendFreeform(phone, text);
  } else {
    return res.status(400).json({ error: 'template or text required' });
  }

  return res.status(200).json(result);
};
