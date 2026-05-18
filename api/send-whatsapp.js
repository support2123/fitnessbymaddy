const { sendTemplate, sendFreeform } = require('../lib/whatsapp');
const { parseBody, cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = await parseBody(req);
    const { phone, template, params, message, skipRateLimit } = body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || [], !!skipRateLimit);
    } else if (message) {
      result = await sendFreeform(phone, message, !!skipRateLimit);
    } else {
      return res.status(400).json({ error: 'Provide template or message' });
    }

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
