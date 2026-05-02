const { sendTemplate, sendText } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate internal API key
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = req.body || {};
    const { phone, template, params, text } = body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing required field: phone' });
    }

    if (!template && !text) {
      return res.status(400).json({ error: 'Either template or text must be provided' });
    }

    let result;

    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else {
      result = await sendText(phone, text);
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('send-whatsapp error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
