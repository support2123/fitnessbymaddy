const { sendTemplate, sendFreeform, maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY && process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, message } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    let result;
    if (type === 'template') {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'freeform') {
      result = await sendFreeform(phone, message);
    } else {
      return res.status(400).json({ error: 'type must be "template" or "freeform"' });
    }

    return res.status(result.success ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
