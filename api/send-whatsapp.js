const { sendTemplate, sendText, checkRateLimit } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, type, template_name, params, text, is_client } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    const canSend = await checkRateLimit(phone, !!is_client);
    if (!canSend) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for non-clients' });
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Either template_name or text required' });
    }

    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error('[SendWA Error]', error.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
