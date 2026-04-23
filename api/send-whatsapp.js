const { sendTemplate, sendTextMessage, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, template, params, text, is_client } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    // Rate limit check
    const allowed = await canSendMessage(phone, !!is_client);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hrs for leads' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendTextMessage(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    return res.status(200).json({ success: true, result });

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
