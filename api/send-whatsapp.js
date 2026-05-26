const { sendTemplate, sendText, sendDocument, isRateLimited } = require('./_utils/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, message, document_url, caption, skip_rate_limit } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!skip_rate_limit) {
      const limited = await isRateLimited(phone);
      if (limited) {
        return res.json({ sent: false, reason: 'rate_limited' });
      }
    }

    let result;

    switch (type) {
      case 'template':
        if (!template_name) return res.status(400).json({ error: 'template_name required' });
        result = await sendTemplate(phone, template_name, params || []);
        break;

      case 'text':
        if (!message) return res.status(400).json({ error: 'message required' });
        result = await sendText(phone, message);
        break;

      case 'document':
        if (!document_url) return res.status(400).json({ error: 'document_url required' });
        result = await sendDocument(phone, document_url, caption || '');
        break;

      default:
        return res.status(400).json({ error: 'type must be template, text, or document' });
    }

    return res.json(result);

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
