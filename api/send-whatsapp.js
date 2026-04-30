const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, body, params } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (templateName) {
      result = await sendWhatsApp({ phone, templateName, body, params });
    } else if (body) {
      result = await sendFreeformWhatsApp({ phone, body });
    } else {
      return res.status(400).json({ error: 'templateName or body required' });
    }

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
