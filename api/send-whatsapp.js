const { sendTemplate, sendFreeform, sendMediaTemplate } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Internal-only: verify via a simple shared key
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, message, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'media' && template_name && media_url) {
      result = await sendMediaTemplate(phone, template_name, params || [], media_url);
    } else if (type === 'freeform' && message) {
      result = await sendFreeform(phone, message);
    } else {
      return res.status(400).json({ error: 'Invalid type or missing fields' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
