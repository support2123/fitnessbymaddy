const { sendTemplate, sendText, canSendMessage } = require('./_lib/whatsapp');
const { cors, maskPhone } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, type, template_name, params, text } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({
        error: 'Rate limited',
        detail: `Max 1 outbound per 2hrs for non-clients. Phone: ${maskPhone(phone)}`
      });
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template_name or text' });
    }

    return res.status(200).json({ success: true, result });

  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
