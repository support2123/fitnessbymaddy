const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, message, templateName } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    const result = await sendWhatsApp({ phone, message, templateName });

    if (!result.ok) {
      console.error('Send failed for', maskPhone(phone), result.error);
      return res.status(429).json({ error: result.error });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
