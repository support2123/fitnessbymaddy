const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Simple API key auth for internal use
  const authKey = req.headers['x-api-key'];
  if (authKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, params, message, bypassRateLimit } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    let result;
    if (templateName) {
      result = await sendWhatsApp({
        phone,
        templateName,
        params: params || [],
        bypassRateLimit: !!bypassRateLimit
      });
    } else if (message) {
      result = await sendFreeformWhatsApp({
        phone,
        message,
        bypassRateLimit: !!bypassRateLimit
      });
    } else {
      return res.status(400).json({ error: 'templateName or message required' });
    }

    return res.json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
