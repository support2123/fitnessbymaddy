const { sendWhatsApp } = require('../lib/whatsapp');
const { canSendMessage, logMessage } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, params, isClient } = req.body;
  if (!phone || !templateName) {
    return res.status(400).json({ error: 'phone and templateName required' });
  }

  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) {
    return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for leads' });
  }

  const result = await sendWhatsApp(phone, templateName, params || {});
  await logMessage(phone, 'out', `Template: ${templateName}`, templateName, result.ok ? 'sent' : 'failed');

  return res.status(result.ok ? 200 : 502).json(result);
};
