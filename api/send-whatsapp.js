const { sendTemplate, sendFreeform, canSendMessage } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  const expected = `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`;
  if (authHeader !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, message } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (message) {
      result = await sendFreeform(phone, message);
    } else {
      return res.status(400).json({ error: 'Provide template or message' });
    }

    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
