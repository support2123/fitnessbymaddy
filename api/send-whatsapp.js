const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, body_values, media_url, freeform_message } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (freeform_message) {
      result = await sendFreeformWhatsApp(phone, freeform_message);
    } else if (template_name) {
      result = await sendWhatsApp(phone, template_name, body_values || [], media_url);
    } else {
      return res.status(400).json({ error: 'template_name or freeform_message required' });
    }

    return res.status(200).json({ ok: true, result });

  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
