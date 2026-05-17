const { sendTemplate, sendSession } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, params, text, userName } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    let result;
    if (type === 'template') {
      if (!templateName) return res.status(400).json({ error: 'templateName required for template type' });
      result = await sendTemplate(phone, templateName, params || [], userName);
    } else {
      if (!text) return res.status(400).json({ error: 'text required for session type' });
      result = await sendSession(phone, text);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
