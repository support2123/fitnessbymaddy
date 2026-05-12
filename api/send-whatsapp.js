const { sendTemplate, sendDirect, sendTextMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (text) {
      result = await sendTextMessage(phone, text);
    } else if (template) {
      result = force
        ? await sendDirect(phone, template, params || {})
        : await sendTemplate(phone, template, params || {});
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    return res.status(result.ok ? 200 : 429).json(result);

  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
