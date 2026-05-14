const { sendWhatsApp, sendTemplate, isRateLimited } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/pii');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, message, template, params, skipRateLimit } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone is required' });

    if (!skipRateLimit) {
      const limited = await isRateLimited(phone);
      if (limited) {
        return res.status(429).json({
          error: 'Rate limited',
          detail: `Max 1 message per 2 hours for ${maskPhone(phone)}`,
        });
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (message) {
      result = await sendWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'message or template required' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
