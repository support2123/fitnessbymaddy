const { sendWhatsApp } = require('./lib/whatsapp');
const { jsonResponse } = require('./lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, message, template } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: 'phone and message required' });
    }

    const result = await sendWhatsApp(phone, message, template);

    if (result.rateLimited) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for non-clients' });
    }

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
