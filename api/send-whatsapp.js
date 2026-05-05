const { sendTemplate, sendText, checkRateLimit } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, text, skipRateLimit } = req.body;
  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  if (!skipRateLimit) {
    const canSend = await checkRateLimit(phone);
    if (!canSend) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for leads' });
    }
  }

  try {
    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    return res.json({ ok: true, result });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
