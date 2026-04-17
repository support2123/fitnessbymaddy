const { canSendMessage, sendTemplate, sendText } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const expectedKey = process.env.INTERNAL_API_KEY;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, is_client } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const allowed = await canSendMessage(phone, !!is_client);
    if (!allowed) {
      return res.status(429).json({
        error: 'Rate limited',
        message: `Cannot send to ${maskPhone(phone)} — last message was < 2 hours ago`,
      });
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'text' && text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template_name, or type=text with text' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
