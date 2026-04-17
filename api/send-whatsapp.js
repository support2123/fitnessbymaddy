const { sendTemplate, sendText, isRateLimitedForLead } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, type, template_name, params, text } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const rateLimited = await isRateLimitedForLead(phone);
    if (rateLimited) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for leads' });
    }

    let result;
    if (type === 'template') {
      if (!template_name) return res.status(400).json({ error: 'Missing template_name' });
      result = await sendTemplate(phone, template_name, params || []);
    } else {
      if (!text) return res.status(400).json({ error: 'Missing text' });
      result = await sendText(phone, text);
    }

    if (!result.ok) {
      return res.status(502).json({ error: 'WhatsApp send failed', details: result });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
