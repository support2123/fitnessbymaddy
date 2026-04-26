const { sendTemplate, sendSessionMessage, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const authHeader = req.headers['authorization'] || '';
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, type, template_name, params, message, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const allowed = await canSendMessage(phone, is_client || false);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'session' && message) {
      result = await sendSessionMessage(phone, message);
    } else {
      return res.status(400).json({ error: 'Specify type=template with template_name, or type=session with message' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
