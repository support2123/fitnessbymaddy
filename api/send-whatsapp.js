const { sendWhatsApp } = require('./_lib/whatsapp');
const { corsHeaders } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (corsHeaders(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, message, templateName, templateParams } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });
    if (!message && !templateName) {
      return res.status(400).json({ error: 'message or templateName required' });
    }

    const result = await sendWhatsApp({ phone, message, templateName, templateParams });
    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
