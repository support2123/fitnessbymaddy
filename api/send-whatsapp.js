const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const internalKey = req.headers['x-internal-key'];
  if (internalKey !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, body, params } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  const result = await sendWhatsApp({ phone, templateName, body, params });
  res.json(result);
};
