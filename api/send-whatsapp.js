const { canSend, sendTemplate, sendText } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text, isClient } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (!template && !text) return res.status(400).json({ error: 'template or text required' });

    const allowed = await canSend(phone, !!isClient);
    if (!allowed) {
      return res.status(429).json({
        error: 'Rate limited',
        detail: `Max 1 message per 2hrs for non-clients. Phone: ${maskPhone(phone)}`
      });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else {
      result = await sendText(phone, text);
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
