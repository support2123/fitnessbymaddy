const { sendMessage, canSend } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, text, templateName, isClient, params } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (!text && !templateName) return res.status(400).json({ error: 'text or templateName required' });

    if (!isClient && !await canSend(phone)) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for non-clients' });
    }

    const result = await sendMessage(phone, text, {
      templateName,
      isClient: !!isClient,
      params
    });

    return res.status(200).json({ success: true, result });

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
