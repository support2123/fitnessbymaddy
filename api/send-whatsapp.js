const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');
const { maskPhone, jsonResponse } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, message, mediaUrl } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    let result;
    if (template) {
      result = await sendWhatsApp(phone, template, params || [], mediaUrl);
    } else if (message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'template or message required' });
    }

    if (result === null) {
      return res.status(429).json({ error: 'Rate limited or dropped', phone: maskPhone(phone) });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
