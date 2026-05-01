const { sendTemplate, sendText, canSendMessage, maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, text } = req.body;

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  const allowed = await canSendMessage(phone);
  if (!allowed) {
    return res.status(429).json({
      error: 'Rate limited — max 1 message per 2 hours for non-clients',
      phone: maskPhone(phone),
    });
  }

  if (template) {
    const result = await sendTemplate(phone, template, params || []);
    return res.json({ ok: result.ok, method: 'template', phone: maskPhone(phone) });
  }

  if (text) {
    const result = await sendText(phone, text);
    return res.json({ ok: result.ok, method: 'text', phone: maskPhone(phone) });
  }

  return res.status(400).json({ error: 'Provide template or text' });
};
