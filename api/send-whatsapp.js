const { canSendMessage, sendTemplate, sendText } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, type, template, params, text, isClient } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const allowed = await canSendMessage(phone, !!isClient);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2hrs for leads' });
    }

    let result;
    if (type === 'template' && template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (type === 'text' && text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template name, or type=text with text' });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('Send WA error:', maskPhone(req.body?.phone || ''), err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
