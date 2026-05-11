const { sendWhatsApp, sendFreeformWhatsApp, maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, body_values, message, media_url } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    let result;
    if (template_name) {
      result = await sendWhatsApp(phone, template_name, body_values || [], media_url || null);
    } else if (message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'template_name or message required' });
    }

    if (!result.sent) {
      return res.status(429).json({ error: 'Rate limited', phone: maskPhone(phone) });
    }

    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
