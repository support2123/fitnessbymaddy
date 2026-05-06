const { sendTemplate, sendText, canSendToLead } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, text, skipRateLimit } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Missing phone' });
  }

  if (!skipRateLimit) {
    const canSend = await canSendToLead(phone);
    if (!canSend) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for leads' });
    }
  }

  if (template) {
    const result = await sendTemplate(phone, template, params || []);
    return res.status(result.ok ? 200 : 502).json(result);
  }

  if (text) {
    const result = await sendText(phone, text);
    return res.status(result.ok ? 200 : 502).json(result);
  }

  return res.status(400).json({ error: 'Provide template or text' });
};
