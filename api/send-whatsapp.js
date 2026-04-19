const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');
const { sanitizeInput } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, message, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (template_name) {
      result = await sendWhatsApp(
        sanitizeInput(phone),
        sanitizeInput(template_name),
        Array.isArray(params) ? params.map(p => sanitizeInput(String(p))) : [],
        media_url || null
      );
    } else if (message) {
      result = await sendFreeformWhatsApp(sanitizeInput(phone), sanitizeInput(message));
    } else {
      return res.status(400).json({ error: 'Provide template_name or message' });
    }

    return res.json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
