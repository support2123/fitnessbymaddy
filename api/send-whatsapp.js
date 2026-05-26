const { sendTemplate, sendTextMessage } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'text' && text) {
      result = await sendTextMessage(phone, text);
    } else {
      return res.status(400).json({ error: 'Invalid type. Use "template" or "text"' });
    }

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (error) {
    console.error('Send WhatsApp error:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
