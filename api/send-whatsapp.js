const { sendTemplate, sendText, canSendMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.CRON_SECRET || 'internal'}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    const allowed = await canSendMessage(phone, is_client || false);
    if (!allowed) {
      return res.status(429).json({ error: 'rate limited — max 1 msg per 2hrs for non-clients' });
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'text' && text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'invalid type — use "template" or "text"' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};
