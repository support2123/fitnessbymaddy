const { sendTemplate, sendFreeform, checkRateLimit } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Internal-only: verify request comes from our own server
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, message } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (message) {
      result = await sendFreeform(phone, message);
    } else {
      return res.status(400).json({ error: 'Must provide template or message' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
