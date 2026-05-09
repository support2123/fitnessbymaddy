const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, body_values, media_url, freeform_message } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    let result;
    if (freeform_message) {
      result = await sendFreeformWhatsApp(phone, freeform_message);
    } else if (template_name) {
      result = await sendWhatsApp(phone, template_name, body_values || [], media_url);
    } else {
      return res.status(400).json({ error: 'template_name or freeform_message required' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
