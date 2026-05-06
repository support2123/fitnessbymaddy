const { sendTemplate, sendText } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, skip_rate_limit } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || [], !!skip_rate_limit);
    } else if (type === 'text' && text) {
      result = await sendText(phone, text, !!skip_rate_limit);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template_name, or type=text with text' });
    }

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
