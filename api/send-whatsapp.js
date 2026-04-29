const { sendWhatsApp, sendFreeform, checkRateLimit } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template_name, params, message, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (template_name) {
      const result = await sendWhatsApp(phone, template_name, params || [], media_url);
      return res.status(200).json(result);
    }

    if (message) {
      const result = await sendFreeform(phone, message);
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'template_name or message required' });

  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
