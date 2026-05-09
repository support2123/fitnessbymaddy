const { sendTemplate, sendText } = require('./lib/whatsapp');
const { canSendTo } = require('./lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, params, message, bypassRateLimit } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    if (!bypassRateLimit) {
      const allowed = await canSendTo(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for leads' });
      }
    }

    let result;
    if (type === 'template') {
      result = await sendTemplate(phone, templateName, params || []);
    } else {
      result = await sendText(phone, message);
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('[send-whatsapp]', err);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
