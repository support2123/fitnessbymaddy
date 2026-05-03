const { sendTemplate, sendFreeform, canSendMessage, maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Internal use only — verify request origin
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, message, force } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    // Rate limit check (skip for force sends to opted-in clients)
    if (!force) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return res.status(429).json({
          error: 'Rate limited',
          message: `Cannot send to ${maskPhone(phone)} — last message within 2 hours`
        });
      }
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
    console.error('[Send WA] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
