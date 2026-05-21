const { sendMessage } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/mask-phone');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, body, templateName, isClient } = req.body;
    if (!phone || !templateName) {
      return res.status(400).json({ error: 'Missing phone or templateName' });
    }

    const result = await sendMessage(phone, body, templateName, !!isClient);
    console.log(`Sent ${templateName} to ${maskPhone(phone)}`);
    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
