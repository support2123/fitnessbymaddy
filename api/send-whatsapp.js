const { sendTemplate, sendText } = require('./_lib/whatsapp');
const { normalizePhone } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, skip_rate_limit } = req.body;
    const normalized = normalizePhone(phone);

    if (!normalized) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(normalized, template_name, params || [], !!skip_rate_limit);
    } else if (type === 'text' && text) {
      result = await sendText(normalized, text, !!skip_rate_limit);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template_name, or type=text with text' });
    }

    return res.json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
