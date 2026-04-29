const { sendTemplate, sendFreeform, sendMediaTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  const expectedToken = process.env.INTERNAL_API_TOKEN;
  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, message, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (type === 'template') {
      if (!template_name) return res.status(400).json({ error: 'Missing template_name' });
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'media') {
      if (!template_name || !media_url) return res.status(400).json({ error: 'Missing template_name or media_url' });
      result = await sendMediaTemplate(phone, template_name, media_url, params || []);
    } else if (type === 'freeform') {
      if (!message) return res.status(400).json({ error: 'Missing message' });
      result = await sendFreeform(phone, message);
    } else {
      return res.status(400).json({ error: 'Invalid type. Use: template, media, or freeform' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
