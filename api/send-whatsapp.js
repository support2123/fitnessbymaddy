const { sendTemplate, sendFreeform } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, params, message, isClient } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (templateName) {
      result = await sendTemplate(phone, templateName, params || [], isClient || false);
    } else if (message) {
      result = await sendFreeform(phone, message, isClient || false);
    } else {
      return res.status(400).json({ error: 'Provide templateName or message' });
    }

    return res.json(result);
  } catch (err) {
    console.error('[SEND-WA ERROR]', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
