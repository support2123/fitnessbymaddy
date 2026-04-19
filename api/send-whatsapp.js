const { sendTemplate, sendTextMessage, checkRateLimit, maskPhone } = require('./_lib/whatsapp');
const { cors, parseBody } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { phone, template, text, params, bypass_rate_limit } = body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });
    if (!template && !text) return res.status(400).json({ error: 'Missing template or text' });

    if (!bypass_rate_limit) {
      const limited = await checkRateLimit(phone);
      if (limited) {
        return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours' });
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || {});
    } else {
      result = await sendTextMessage(phone, text);
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
