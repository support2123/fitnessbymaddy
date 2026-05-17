const { sendTemplate, sendText, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers['authorization'];
  const PUBLIC_TEMPLATES = ['reschedule_request'];
  const isPublicTemplate = PUBLIC_TEMPLATES.includes(req.body && req.body.template_name);
  if (!isPublicTemplate && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const isClient = is_client === true;

    const allowed = await canSendMessage(phone, isClient);
    if (!allowed) {
      return res.json({ ok: false, reason: 'rate_limited' });
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || [], isClient);
    } else if (type === 'text' && text) {
      result = await sendText(phone, text, isClient);
    } else {
      return res.status(400).json({ error: 'specify type=template with template_name, or type=text with text' });
    }

    return res.json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
