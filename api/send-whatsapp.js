const { sendWhatsApp, sendFreeformWhatsApp, checkRateLimit } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, body_values, message, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const limited = await checkRateLimit(phone);
    if (limited) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for this number' });
    }

    let result;
    if (template_name) {
      result = await sendWhatsApp({
        phone,
        templateName: template_name,
        bodyValues: body_values || [],
        mediaUrl: media_url,
      });
    } else if (message) {
      result = await sendFreeformWhatsApp({ phone, message });
    } else {
      return res.status(400).json({ error: 'template_name or message required' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
