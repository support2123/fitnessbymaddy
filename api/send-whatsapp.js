const { sendTemplate, sendText, sendTemplateForced } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const expected = `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`;
  if (authHeader !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, text, is_client, force } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    let result;

    if (template_name) {
      result = force
        ? await sendTemplateForced(phone, template_name, params)
        : await sendTemplate(phone, template_name, params);
    } else if (text) {
      result = await sendText(phone, text, !!is_client);
    } else {
      return res.status(400).json({ error: 'template_name or text required' });
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('Send WhatsApp error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
