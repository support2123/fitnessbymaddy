const { sendTemplate, sendText } = require('../lib/whatsapp');
const { canSendMessage, logMessage } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, template_name, params, message } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({
        error: 'Rate limited',
        message: 'Max 1 message per lead per 2 hours',
      });
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
      await logMessage(phone, 'out', `Template: ${template_name}`, template_name);
    } else if (message) {
      result = await sendText(phone, message);
      await logMessage(phone, 'out', message, null);
    } else {
      return res.status(400).json({ error: 'template_name or message required' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
