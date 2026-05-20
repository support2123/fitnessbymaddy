const { sendTemplate, sendText, sendDocument, canSendToLead } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers['x-internal-key'];
  if (auth !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template, params, text, documentUrl, caption, skipRateLimit } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!skipRateLimit) {
      const allowed = await canSendToLead(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
      }
    }

    let result;
    if (type === 'template') {
      result = await sendTemplate(phone, template, params || []);
    } else if (type === 'document') {
      result = await sendDocument(phone, documentUrl, caption);
    } else {
      result = await sendText(phone, text);
    }

    return res.status(200).json({ sent: true, result });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
