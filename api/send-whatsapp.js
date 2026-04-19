const { sendWhatsApp, sendTemplate, checkRateLimit } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, message, template_name, template_params, market } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const canSend = await checkRateLimit(phone);
    if (!canSend) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for non-clients' });
    }

    let result;
    if (template_name) {
      const ok = await sendTemplate(phone, template_name, market || 'GLOBAL', template_params);
      result = { sent: ok };
    } else if (message) {
      result = await sendWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'Missing message or template_name' });
    }

    return res.json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
