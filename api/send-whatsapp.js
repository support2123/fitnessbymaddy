const { sendTemplate, sendText, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Internal-only: verify auth header
  const authKey = req.headers['x-internal-key'];
  if (authKey !== process.env.INTERNAL_API_KEY && process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, text, params, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const allowed = await canSendMessage(phone, is_client);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — try again later' });
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, {
        isClient: is_client,
        templateParams: params || [],
        ...(req.body.media ? { media: req.body.media } : {}),
      });
    } else if (type === 'text' && text) {
      result = await sendText(phone, text, is_client);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template_name OR type=text with text' });
    }

    return res.json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
