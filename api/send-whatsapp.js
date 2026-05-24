const { sendTemplate, sendFreeform } = require('../lib/whatsapp');
const { jsonResponse } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, freeform } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (freeform) {
      result = await sendFreeform(phone, freeform);
    } else if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else {
      return res.status(400).json({ error: 'Provide template or freeform' });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
