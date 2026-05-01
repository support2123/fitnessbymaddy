const { sendTemplate, sendText, canMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, template, params, text } = req.body;

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    const allowed = await canMessage(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'rate_limited' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'missing template or text' });
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
