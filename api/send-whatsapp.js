const { sendTemplate, sendFreeform, canSendMessage } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, message } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Missing phone' });
  }

  try {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (message) {
      result = await sendFreeform(phone, message);
    } else {
      return res.status(400).json({ error: 'Provide template or message' });
    }

    return res.status(result.success ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
