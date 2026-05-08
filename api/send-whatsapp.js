const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, params, body } = req.body;
  if (!phone || !templateName) {
    return res.status(400).json({ error: 'Missing phone or templateName' });
  }

  try {
    const result = await sendWhatsApp({ phone, templateName, params, body });
    if (!result.ok) {
      console.error(`WhatsApp send failed for ${maskPhone(phone)}: ${result.reason}`);
    }
    return res.json(result);
  } catch (err) {
    console.error(`WhatsApp error for ${maskPhone(phone)}:`, err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
