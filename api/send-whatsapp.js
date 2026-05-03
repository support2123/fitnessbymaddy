const { sendTemplate, sendText, sendDocument } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Internal-only endpoint — verify with a simple bearer token
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, text, document_url, caption, params } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    let result;
    switch (type) {
      case 'template':
        result = await sendTemplate(phone, template_name, params || {});
        break;
      case 'text':
        result = await sendText(phone, text, params?.isClient);
        break;
      case 'document':
        result = await sendDocument(phone, document_url, caption, params?.isClient);
        break;
      default:
        return res.status(400).json({ error: 'type must be template, text, or document' });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
