const { canSendToLead, sendTemplate, sendTextMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, params, text, isClient } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    if (!isClient) {
      const allowed = await canSendToLead(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for leads' });
      }
    }

    let result;
    if (templateName) {
      result = await sendTemplate(phone, templateName, params || []);
    } else if (text) {
      result = await sendTextMessage(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide templateName or text' });
    }

    return res.status(200).json({ sent: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
