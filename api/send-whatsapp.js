const { sendTemplate, sendFreeform } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, text, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || [], media_url);
    } else if (text) {
      result = await sendFreeform(phone, text);
    } else {
      return res.status(400).json({ error: 'template_name or text required' });
    }

    if (result.error === 'rate_limited') {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2hrs for non-clients' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
