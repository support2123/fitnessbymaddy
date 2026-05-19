const { sendTemplate, sendText, sendDocument, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, text, document_url, caption, params, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!is_client) {
      const allowed = await canSendMessage(phone, false);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for leads' });
      }
    }

    let result;
    switch (type) {
      case 'template':
        result = await sendTemplate(phone, template_name, params || {});
        break;
      case 'text':
        result = await sendText(phone, text);
        break;
      case 'document':
        result = await sendDocument(phone, document_url, caption);
        break;
      default:
        return res.status(400).json({ error: 'type must be template, text, or document' });
    }

    return res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
