const { sendTemplate, sendText, sendDocument } = require('../lib/whatsapp');
const { normalizePhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template, params, message, documentUrl, caption, isClient } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const normalized = normalizePhone(phone);
    let result;

    if (type === 'template') {
      result = await sendTemplate(normalized, template, params || []);
    } else if (type === 'document') {
      result = await sendDocument(normalized, documentUrl, caption, isClient);
    } else {
      result = await sendText(normalized, message, isClient || false);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
