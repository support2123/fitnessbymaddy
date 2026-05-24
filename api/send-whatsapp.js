const { sendWhatsApp, sendFreeformWhatsApp, canSendMessage } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Internal-only endpoint - verify via secret header
  const authHeader = req.headers['x-internal-secret'];
  if (authHeader !== process.env.INTERNAL_API_SECRET && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, message, params, bypass_rate_limit } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    // Rate limit check (unless bypassed for opted-in clients)
    if (!bypass_rate_limit) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited. Max 1 message per 2 hours for leads.' });
      }
    }

    let result;
    if (template) {
      result = await sendWhatsApp(phone, template, params || {});
    } else if (message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'template or message required' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
