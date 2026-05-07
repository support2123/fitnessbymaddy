const { sendTemplate, sendText, checkRateLimit } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, message, template, params, isClient } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const canSend = await checkRateLimit(phone, isClient === true);
    if (!canSend) return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for leads' });

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params);
    } else if (message) {
      result = await sendText(phone, message);
    } else {
      return res.status(400).json({ error: 'message or template required' });
    }

    return res.status(200).json({ status: 'sent', result });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
