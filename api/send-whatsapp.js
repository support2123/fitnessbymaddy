const { sendTemplate, sendTextMessage } = require('./_lib/whatsapp');
const { handleCors } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, text, skip_rate_limit } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || [], !!skip_rate_limit);
    } else if (text) {
      result = await sendTextMessage(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template_name or text' });
    }

    return res.status(result.success ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
