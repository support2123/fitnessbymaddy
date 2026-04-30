const { sendTemplate, sendTextMessage, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, type, template_name, message, params } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    let result;

    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || {});
    } else if (type === 'text' && message) {
      result = await sendTextMessage(phone, message);
    } else {
      return res.status(400).json({ error: 'Specify type=template with template_name, or type=text with message' });
    }

    if (result?.blocked) {
      return res.status(429).json({
        blocked: true,
        reason: result.reason,
        phone: maskPhone(phone)
      });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
