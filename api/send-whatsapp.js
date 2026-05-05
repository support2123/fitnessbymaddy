const { sendTemplate, sendTextMessage, checkRateLimit, normalizePhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, message, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const normalized = normalizePhone(phone);

    if (!force) {
      const limited = await checkRateLimit(normalized);
      if (limited) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(normalized, template, params || []);
    } else if (message) {
      result = await sendTextMessage(normalized, message);
    } else {
      return res.status(400).json({ error: 'template or message required' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
