const { sendTemplate, sendFreeformMessage, checkRateLimit } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, message } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const rateLimited = await checkRateLimit(phone);
    if (rateLimited) {
      return res.status(429).json({
        error: 'Rate limited',
        detail: `Max 1 message per 2 hours for ${maskPhone(phone)}`
      });
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (message) {
      result = await sendFreeformMessage(phone, message);
    } else {
      return res.status(400).json({ error: 'template_name or message required' });
    }

    return res.status(result.sent ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
