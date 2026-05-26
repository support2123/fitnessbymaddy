const { sendTemplate, sendSessionMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Internal-only endpoint — verify via shared secret
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.INTERNAL_API_SECRET;
  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { phone, template_name, params, message, user_name } = body;

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || [], user_name);
    } else if (message) {
      result = await sendSessionMessage(phone, message);
    } else {
      return res.status(400).json({ error: 'template_name or message required' });
    }

    return res.status(result.ok ? 200 : 429).json(result);

  } catch (err) {
    console.error('Send WhatsApp error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
