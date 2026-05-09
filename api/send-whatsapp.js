const { canSendMessage, sendTemplate, sendText } = require('./_lib/whatsapp');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, text, isClient } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });
  if (!template && !text) return res.status(400).json({ error: 'template or text required' });

  const allowed = await canSendMessage(phone, !!isClient);
  if (!allowed) {
    return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
  }

  let success;
  if (template) {
    success = await sendTemplate(phone, template, params || []);
  } else {
    success = await sendText(phone, text);
  }

  return res.status(success ? 200 : 502).json({ sent: success });
};
