const { sendTemplate, sendText, sendRateLimited } = require('./_lib/whatsapp');
const { normalizePhone } = require('./_lib/phone');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, template, params, text, media_url, bypass_rate_limit } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    const normalizedPhone = normalizePhone(phone);
    let result;

    if (template) {
      if (bypass_rate_limit) {
        result = await sendTemplate(normalizedPhone, template, params || [], media_url);
      } else {
        result = await sendRateLimited(normalizedPhone, template, params || [], media_url);
      }
    } else if (text) {
      result = await sendText(normalizedPhone, text);
    } else {
      return res.status(400).json({ error: 'template or text required' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
