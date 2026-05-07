const { sendTemplate, sendSessionMessage, canSendMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, media_url, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!is_client) {
      const allowed = await canSendMessage(phone, false);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
      }
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || {}, media_url);
    } else if (type === 'session' && text) {
      result = await sendSessionMessage(phone, text);
    } else {
      return res.status(400).json({ error: 'Specify type=template with template_name, or type=session with text' });
    }

    return res.status(result.success ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
