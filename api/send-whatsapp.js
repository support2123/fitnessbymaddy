const { sendWhatsApp, checkRateLimit } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template_name, params, body } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    if (!template_name && !body) {
      return res.status(400).json({ error: 'template_name or body required' });
    }

    const canSend = await checkRateLimit(phone);
    if (!canSend) {
      return res.status(429).json({ error: 'Rate limited (1 msg per 2hrs for non-clients)' });
    }

    const result = await sendWhatsApp({
      phone,
      templateName: template_name,
      body,
      params
    });

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
