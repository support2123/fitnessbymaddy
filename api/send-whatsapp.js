const { sendWhatsApp, sendFreeformWhatsApp } = require('./_lib/whatsapp');
const { cors, parseBody } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const { phone, template_name, params, message, media_url } = body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  if (template_name) {
    const result = await sendWhatsApp(phone, template_name, params || [], media_url);
    return res.status(200).json(result);
  }

  if (message) {
    const ok = await sendFreeformWhatsApp(phone, message);
    return res.status(200).json({ sent: ok });
  }

  return res.status(400).json({ error: 'template_name or message required' });
};
