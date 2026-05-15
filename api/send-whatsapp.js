const { sendTemplate, sendText, canSendToLead } = require('./_lib/whatsapp');
const cors = require('./_lib/cors');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const canSend = await canSendToLead(phone);
    if (!canSend) {
      return res.status(429).json({ error: 'rate_limited', message: 'Max 1 message per 2 hours for leads' });
    }

    let result;
    if (type === 'template') {
      if (!template_name) return res.status(400).json({ error: 'template_name required' });
      result = await sendTemplate(phone, template_name, params || [], media_url);
    } else {
      if (!text) return res.status(400).json({ error: 'text required' });
      result = await sendText(phone, text);
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
