const { sendWhatsApp, sendFreeformWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, message } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' });
  }

  try {
    let result;
    if (template) {
      result = await sendWhatsApp(phone, template, params || {});
    } else if (message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'template or message required' });
    }

    return res.status(200).json({ status: 'ok', result });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
