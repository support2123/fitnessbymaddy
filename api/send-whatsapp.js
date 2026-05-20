const { sendTemplate, sendText, canSendMessage, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-api-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template, text, params, forceSkipRateLimit } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    if (!forceSkipRateLimit) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return res.status(429).json({
          error: 'Rate limited',
          detail: `Max 1 outbound per 2hrs for ${maskPhone(phone)}`,
        });
      }
    }

    let result;
    if (type === 'template' && template) {
      result = await sendTemplate(phone, template, params || {});
    } else if (type === 'text' && text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Specify type=template with template name, or type=text with text body' });
    }

    return res.json({ ok: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
