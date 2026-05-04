const { sendWhatsApp, sendRateLimitedToClient } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, body, params, isClient } = req.body;

  if (!phone || (!templateName && !body)) {
    return res.status(400).json({ error: 'Missing phone or message content' });
  }

  try {
    const result = isClient
      ? await sendRateLimitedToClient({ phone, templateName, body, params })
      : await sendWhatsApp({ phone, templateName, body, params });

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
