const { sendWhatsApp } = require('./_lib/whatsapp');
const { handleCors } = require('./_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, body, params } = req.body;
  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  try {
    const result = await sendWhatsApp({ phone, templateName, body, params });
    return res.json({ ok: true, result });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
