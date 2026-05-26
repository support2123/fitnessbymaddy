const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');
const { cors, parseBody } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const { phone, template, params, message, mediaUrl } = body;

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  let result;
  if (template) {
    result = await sendWhatsApp(phone, template, params || [], mediaUrl);
  } else if (message) {
    result = await sendFreeformWhatsApp(phone, message);
  } else {
    return res.status(400).json({ error: 'Provide template or message' });
  }

  return res.status(result.ok ? 200 : 500).json(result);
};
