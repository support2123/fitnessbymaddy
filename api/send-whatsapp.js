const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, body, params, isClient } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    if (!templateName && !body) {
      return res.status(400).json({ error: 'templateName or body required' });
    }

    const result = await sendWhatsApp({
      phone,
      templateName: templateName || null,
      body: body || null,
      params: params || [],
      isClient: !!isClient
    });

    return res.status(result.sent ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
