const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/masking');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, body, templateName, isClient } = req.body;

  if (!phone || !body) {
    return res.status(400).json({ error: 'phone and body are required' });
  }

  try {
    const result = await sendWhatsApp(phone, body, templateName || null, !!isClient);
    console.log(`Send request: ${maskPhone(phone)} sent=${result.sent}`);
    return res.status(200).json(result);
  } catch (err) {
    console.error(`Send error for ${maskPhone(phone)}:`, err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
