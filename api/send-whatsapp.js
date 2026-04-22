const { sendWhatsApp } = require('../lib/whatsapp');
const { cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, mediaUrl } = req.body;

  if (!phone || !template) {
    return res.status(400).json({ error: 'Missing phone or template' });
  }

  const result = await sendWhatsApp(phone, template, params || [], mediaUrl);

  if (result.ok) {
    return res.status(200).json({ success: true, data: result.data });
  }

  return res.status(result.reason === 'rate_limited' ? 429 : 500).json({
    success: false,
    reason: result.reason || 'send_failed',
  });
};
