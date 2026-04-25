const { sendWhatsAppMessage, sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const authHeader = req.headers['authorization'];
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, message, template_name } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });
    if (!message && !template_name) {
      return res.status(400).json({ error: 'Missing message or template_name' });
    }

    const result = template_name
      ? await sendTemplate(phone, template_name)
      : await sendWhatsAppMessage(phone, message);

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
