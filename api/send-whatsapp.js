const { sendTemplate, sendText, sendDocument } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, type, template_name, params, text, pdf_url, caption } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    let result;

    switch (type) {
      case 'template':
        if (!template_name) return res.status(400).json({ error: 'template_name required' });
        result = await sendTemplate(phone, template_name, params || []);
        break;

      case 'text':
        if (!text) return res.status(400).json({ error: 'text required' });
        result = await sendText(phone, text);
        break;

      case 'document':
        if (!pdf_url) return res.status(400).json({ error: 'pdf_url required' });
        result = await sendDocument(phone, pdf_url, caption || '');
        break;

      default:
        return res.status(400).json({ error: 'type must be template, text, or document' });
    }

    return res.json({ ok: true, result });

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
