const { sendTemplate, sendFreeform } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Internal-only endpoint — verify origin or use a simple shared secret
  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY && process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { phone, template, params, message, bypass_rate_limit } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || [], !!bypass_rate_limit);
    } else if (message) {
      result = await sendFreeform(phone, message, !!bypass_rate_limit);
    } else {
      return res.status(400).json({ error: 'template or message required' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
