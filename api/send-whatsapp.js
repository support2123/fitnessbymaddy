const { sendWhatsApp, canSendMessage } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, body, params } = req.body;
  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  try {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({
        error: 'Rate limited or opted out',
        phone: maskPhone(phone),
      });
    }

    const result = await sendWhatsApp({ phone, templateName, body, params });
    return res.json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
