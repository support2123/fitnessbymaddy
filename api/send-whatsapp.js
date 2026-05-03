const { sendTemplate, sendText } = require('./lib/whatsapp');
const { cors, parseBody, normalizePhone } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const phone = normalizePhone(body.phone);

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  if (body.template) {
    const result = await sendTemplate(phone, body.template, {
      name: body.name || 'there',
      templateParams: body.params || [],
      media: body.media || {},
      buttons: body.buttons || []
    });

    if (result.rateLimited) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for non-clients' });
    }

    return res.status(200).json({ sent: true, result });
  }

  if (body.text) {
    const ok = await sendText(phone, body.text);
    return res.status(ok ? 200 : 500).json({ sent: ok });
  }

  return res.status(400).json({ error: 'Provide template or text' });
};
