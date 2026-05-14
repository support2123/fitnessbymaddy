const { sendTemplate, sendText, maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, params, text } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (type === 'template') {
      if (!templateName) return res.status(400).json({ error: 'Missing templateName' });
      result = await sendTemplate(phone, templateName, params || []);
    } else {
      if (!text) return res.status(400).json({ error: 'Missing text' });
      result = await sendText(phone, text);
    }

    if (result.skipped) {
      return res.status(200).json({
        sent: false,
        reason: result.reason,
        phone: maskPhone(phone),
      });
    }

    return res.status(200).json({ sent: true, phone: maskPhone(phone) });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
