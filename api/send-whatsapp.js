const { sendTemplate, sendSessionMessage, isRateLimited } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, params, message } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    const skipRateLimit = params && params.skipRateLimit;
    if (!skipRateLimit) {
      const limited = await isRateLimited(normalizedPhone);
      if (limited) {
        return res.status(429).json({
          error: 'Rate limited',
          phone: maskPhone(normalizedPhone)
        });
      }
    }

    let result;
    if (type === 'template') {
      result = await sendTemplate(normalizedPhone, templateName, params || {});
    } else {
      result = await sendSessionMessage(normalizedPhone, message);
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
