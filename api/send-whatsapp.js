const { sendTemplate, sendText } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, text } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone required' });
  }

  try {
    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    if (result.rateLimited) {
      return res.status(429).json({ error: 'Rate limited', phone });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
