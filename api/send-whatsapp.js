const { sendWhatsApp, canSendMessage, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, body, params } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });
    if (!templateName && !body) return res.status(400).json({ error: 'Missing templateName or body' });

    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({
        error: 'Rate limited',
        phone: maskPhone(phone),
        message: 'Max 1 message per 2hrs for non-clients'
      });
    }

    const result = await sendWhatsApp({ phone, templateName, body, params });
    return res.json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
