const { sendTemplate, sendText } = require('./lib/whatsapp');
const { cors, parseBody, normalizePhone } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = await parseBody(req);
    const { phone, template, params, text } = body;
    const normalized = normalizePhone(phone);

    if (!normalized) {
      return res.status(400).json({ error: 'Phone required' });
    }

    let result;
    if (template) {
      result = await sendTemplate(normalized, template, params || []);
    } else if (text) {
      result = await sendText(normalized, text);
    } else {
      return res.status(400).json({ error: 'template or text required' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('[SendWA] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
