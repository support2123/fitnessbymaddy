const { sendWhatsApp } = require('../lib/whatsapp');
const { jsonResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, body, templateName } = req.body;
  if (!phone || !body) {
    return res.status(400).json({ error: 'phone and body required' });
  }

  try {
    const result = await sendWhatsApp(phone, body, templateName);
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
