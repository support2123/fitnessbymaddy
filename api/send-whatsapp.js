const { sendTemplate, sendText, checkRateLimit } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, template, params, message, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    if (!force) {
      const limited = await checkRateLimit(phone);
      if (limited) {
        return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours' });
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (message) {
      result = await sendText(phone, message);
    } else {
      return res.status(400).json({ error: 'Provide template or message' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
