const { sendTemplate, sendText, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, message, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!is_client) {
      const allowed = await canSendMessage(phone, false);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for leads' });
      }
    }

    let result;
    if (type === 'template') {
      if (!template_name) return res.status(400).json({ error: 'template_name required' });
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'text') {
      if (!message) return res.status(400).json({ error: 'message required' });
      result = await sendText(phone, message);
    } else {
      return res.status(400).json({ error: 'type must be "template" or "text"' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
