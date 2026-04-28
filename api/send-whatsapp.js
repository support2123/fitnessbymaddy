const { sendTemplate, sendSession } = require('./_lib/whatsapp');
const { canSendTo } = require('./_lib/rate-limiter');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, template, params, text, name, bypass_rate_limit } = req.body || {};

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    if (!bypass_rate_limit) {
      const allowed = await canSendTo(phone);
      if (!allowed) return res.status(429).json({ error: 'rate_limited' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || [], name || 'there');
    } else if (text) {
      result = await sendSession(phone, text);
    } else {
      return res.status(400).json({ error: 'missing template or text' });
    }

    return res.json({ ok: true, result });
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
