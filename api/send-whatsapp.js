const { sendWhatsApp } = require('../lib/whatsapp');
const { cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, bodyValues, mediaUrl } = req.body || {};

  if (!phone || !templateName) {
    return res.status(400).json({ error: 'phone and templateName required' });
  }

  try {
    const result = await sendWhatsApp({ phone, templateName, bodyValues, mediaUrl });
    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
