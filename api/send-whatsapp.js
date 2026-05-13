const { sendWhatsApp, sendTemplate, checkRateLimit } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, message, template, params, skipRateLimit } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    if (!skipRateLimit) {
      const limited = await checkRateLimit(phone);
      if (limited) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hours for non-clients' });
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (message) {
      result = await sendWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'message or template required' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
