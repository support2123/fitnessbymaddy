const { sendTemplate, sendText, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, type, template_name, params, message } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2hrs for non-clients' });
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'text' && message) {
      result = await sendText(phone, message);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template_name, or type=text with message' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
