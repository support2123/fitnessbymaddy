const { sendTemplate, sendTextMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text, isClient } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone is required' });

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || [], !!isClient);
    } else if (text) {
      result = await sendTextMessage(phone, text, !!isClient);
    } else {
      return res.status(400).json({ error: 'template or text is required' });
    }

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
