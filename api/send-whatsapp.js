const { sendWhatsApp, checkRateLimitForClient } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, body, params } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const canSend = await checkRateLimitForClient(phone);
    if (!canSend) {
      return res.status(429).json({ error: 'Rate limited', retry_after_ms: 7200000 });
    }

    const result = await sendWhatsApp({
      phone,
      templateName: template_name || 'generic_message',
      body: body || '',
      params: params || []
    });

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
