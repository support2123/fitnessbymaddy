const { sendWhatsApp, normalizePhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, body, params } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    const result = await sendWhatsApp({
      phone: normalizePhone(phone),
      templateName,
      body,
      params
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
