const { sendWhatsApp, sendTextMessage } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    let result;
    if (template) {
      result = await sendWhatsApp(phone, template, params || {});
    } else if (text) {
      result = await sendTextMessage(phone, text);
    } else {
      return res.status(400).json({ error: 'template or text required' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
