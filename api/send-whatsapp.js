const { sendTemplate, sendClientMessage, sendSessionMessage, canSendMessage, maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, body, is_client } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    let result;

    if (type === 'template') {
      if (!template_name) {
        return res.status(400).json({ error: 'template_name is required for template type' });
      }
      result = is_client
        ? await sendClientMessage(phone, template_name, params || [])
        : await sendTemplate(phone, template_name, params || []);
    } else if (type === 'session') {
      if (!body) {
        return res.status(400).json({ error: 'body is required for session type' });
      }
      result = await sendSessionMessage(phone, body);
    } else {
      return res.status(400).json({ error: 'type must be "template" or "session"' });
    }

    return res.status(200).json({ ok: result.ok, data: result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
