const { sendWhatsApp, sendWhatsAppToClient } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, message, template, is_client } = req.body;
    if (!phone || (!message && !template)) {
      return res.status(400).json({ error: 'Missing phone or message/template' });
    }

    const result = is_client
      ? await sendWhatsAppToClient(phone, message, template)
      : await sendWhatsApp(phone, message, template);

    return res.json(result);
  } catch (err) {
    console.error('Send WA error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
