const { sendTemplate, sendText, sendDocument } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== 'Bearer ' + process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, document_url, caption } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    let result;

    if (type === 'template') {
      if (!template_name) {
        return res.status(400).json({ error: 'template_name required for template type' });
      }
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'document') {
      if (!document_url) {
        return res.status(400).json({ error: 'document_url required for document type' });
      }
      result = await sendDocument(phone, document_url, caption || '');
    } else {
      if (!text) {
        return res.status(400).json({ error: 'text required for text type' });
      }
      result = await sendText(phone, text);
    }

    if (result.rateLimited) {
      return res.status(429).json({ error: 'Rate limited', retryAfter: '2h' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
