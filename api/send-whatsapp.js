const { sendTemplate, sendText, checkRateLimit } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, params, textBody, skipRateLimit } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    if (!skipRateLimit) {
      const limited = await checkRateLimit(phone);
      if (limited) {
        return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours' });
      }
    }

    let result;
    if (templateName) {
      result = await sendTemplate(phone, templateName, params);
    } else if (textBody) {
      result = await sendText(phone, textBody);
    } else {
      return res.status(400).json({ error: 'templateName or textBody required' });
    }

    return res.status(200).json({ sent: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
