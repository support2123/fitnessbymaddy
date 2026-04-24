const { sendWhatsApp, canSendMessage, maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, params, force } = req.body || {};

  if (!phone || !templateName) {
    return res.status(400).json({ error: 'phone and templateName required' });
  }

  if (!force) {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({
        error: 'Rate limited',
        detail: `${maskPhone(phone)} already messaged within 2 hours`
      });
    }
  }

  const result = await sendWhatsApp(phone, templateName, params || {}, !!force);
  return res.status(result.ok ? 200 : 502).json(result);
};
