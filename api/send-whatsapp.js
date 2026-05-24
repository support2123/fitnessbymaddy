const { sendTemplate, sendWhatsAppText, canSendMessage } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template, params, text, isClient } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    const allowed = await canSendMessage(phone, !!isClient);
    if (!allowed) {
      return res.status(429).json({
        error: 'Rate limited',
        detail: `Max 1 message per 2hrs for leads. Phone: ${maskPhone(phone)}`
      });
    }

    let result;
    if (type === 'template' && template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (type === 'text' && text) {
      result = await sendWhatsAppText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template name, or type=text with text' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
