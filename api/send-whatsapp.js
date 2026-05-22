const { sendTemplate, sendText, sendMediaTemplate, canSendToLead } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, text, params, pdfUrl, checkRateLimit } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    if (checkRateLimit) {
      const allowed = await canSendToLead(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited: max 1 message per 2 hours for leads' });
      }
    }

    let result;
    if (type === 'template') {
      result = await sendTemplate(phone, templateName, params || {});
    } else if (type === 'media') {
      result = await sendMediaTemplate(phone, templateName, pdfUrl, params || {});
    } else {
      result = await sendText(phone, text);
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
