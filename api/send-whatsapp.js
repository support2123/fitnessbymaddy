const { sendWhatsAppWithRateLimit, sendSessionMessage } = require('./_lib/whatsapp');
const { cors, parseBody } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const body = await parseBody(req);
    const { phone, template, params, message, userName, isClient } = body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (template) {
      result = await sendWhatsAppWithRateLimit(
        phone, template, params || [], userName || 'there', !!isClient
      );
    } else if (message) {
      result = await sendSessionMessage(phone, message);
    } else {
      return res.status(400).json({ error: 'template or message required' });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
