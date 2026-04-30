const { sendTemplate, sendText, canSendToLead } = require('./lib/whatsapp');
const { cors } = require('./lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template, params, text, skipRateLimit } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    if (!skipRateLimit) {
      const allowed = await canSendToLead(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
      }
    }

    let result;
    if (type === 'template' && template) {
      result = await sendTemplate(phone, template, params);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    return res.json({ ok: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
