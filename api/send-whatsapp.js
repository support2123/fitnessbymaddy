const { rateLimitedSend, sendTemplate, sendText } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/mask-phone');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, text, force } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    let result;

    if (template_name) {
      if (force) {
        result = await sendTemplate(phone, template_name, params || []);
      } else {
        result = await rateLimitedSend(phone, template_name, params || []);
      }
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'template_name or text required' });
    }

    console.log(`WhatsApp sent to ${maskPhone(phone)}: ${result.ok ? 'success' : 'failed'}`);

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
