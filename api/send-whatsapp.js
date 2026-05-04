const { sendTemplate, sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text, force } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || [], force ? { force: true } : undefined);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'template or text required' });
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
