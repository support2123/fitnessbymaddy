const { sendWhatsApp, sendFreeformMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, freeform, text } = req.body;

  if (!phone) return res.status(400).json({ error: 'Phone required' });

  try {
    let result;
    if (freeform && text) {
      result = await sendFreeformMessage(phone, text);
    } else if (template) {
      result = await sendWhatsApp(phone, template, params || {});
    } else {
      return res.status(400).json({ error: 'Provide template or freeform+text' });
    }

    return res.json(result);
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
