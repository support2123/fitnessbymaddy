const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { phone, templateName, body, params } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (!templateName && !body) return res.status(400).json({ error: 'templateName or body required' });

    const result = await sendWhatsApp({ phone, templateName, body, params });
    console.log(`Send WA to ${maskPhone(phone)}: sent=${result.sent}`);
    return res.json(result);

  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
