const { sendWithRateLimit, sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params = [], bypassRateLimit = false } = req.body;
  if (!phone || !template) {
    return res.status(400).json({ error: 'phone and template required' });
  }

  try {
    const result = bypassRateLimit
      ? await sendTemplate(phone, template, params)
      : await sendWithRateLimit(phone, template, params);

    if (result.rateLimited) {
      return res.status(429).json({ error: 'Rate limited', phone: maskPhone(phone) });
    }

    return res.status(200).json({ ok: result.ok });
  } catch (err) {
    console.error(`Send error ${maskPhone(phone)}:`, err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
