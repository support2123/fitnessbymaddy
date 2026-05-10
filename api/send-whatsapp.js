const { sendWhatsApp, checkRateLimit } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const expectedKey = process.env.INTERNAL_API_KEY;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, params, body, skipRateLimit } = req.body || {};

    if (!phone || !templateName) {
      return res.status(400).json({ error: 'phone and templateName are required' });
    }

    if (!skipRateLimit) {
      const limited = await checkRateLimit(phone);
      if (limited) {
        return res.status(429).json({ error: 'Rate limited: max 1 message per 2 hours' });
      }
    }

    const result = await sendWhatsApp({
      phone,
      templateName,
      params: params || [],
      body: body || ''
    });

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
