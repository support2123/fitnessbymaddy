const { sendTemplate, sendTextMessage, canSendMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, type, template_name, params, text, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const allowed = await canSendMessage(phone, !!is_client);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — wait 2 hours between messages for non-clients' });
    }

    if (type === 'template') {
      if (!template_name) return res.status(400).json({ error: 'template_name required' });
      const result = await sendTemplate(phone, template_name, params || []);
      return res.status(200).json({ success: true, result });
    }

    if (type === 'text') {
      if (!text) return res.status(400).json({ error: 'text required' });
      await sendTextMessage(phone, text);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'type must be "template" or "text"' });

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
