const { sendWhatsApp, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, message, templateName, templateParams, isClient } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone is required' });
    }
    if (!message && !templateName) {
      return res.status(400).json({ error: 'Message or templateName is required' });
    }

    const allowed = await canSendMessage(phone, !!isClient);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — last message sent less than 2 hours ago' });
    }

    const result = await sendWhatsApp({ phone, message, templateName, templateParams });
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
