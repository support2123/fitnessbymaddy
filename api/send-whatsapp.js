const { sendTemplate, sendText } = require('./lib/whatsapp');
const { canSendTo } = require('./lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, text, params, isClient } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const allowed = await canSendTo(phone, isClient);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
    }

    let result;
    if (type === 'template' && templateName) {
      result = await sendTemplate(phone, templateName, params || {});
    } else if (type === 'text' && text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide type=template+templateName or type=text+text' });
    }

    return res.json({ ok: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
