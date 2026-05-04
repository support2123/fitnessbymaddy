const { sendTemplate, sendTextMessage, sendDocument, canSendToLead } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template, params, text, documentUrl, caption, skipRateLimit } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    if (!skipRateLimit) {
      const allowed = await canSendToLead(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for leads' });
      }
    }

    let result;

    if (type === 'template' && template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (type === 'text' && text) {
      result = await sendTextMessage(phone, text);
    } else if (type === 'document' && documentUrl) {
      result = await sendDocument(phone, documentUrl, caption || '');
    } else {
      return res.status(400).json({ error: 'Invalid message type. Use: template, text, or document' });
    }

    return res.status(200).json({ success: true, result });

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
