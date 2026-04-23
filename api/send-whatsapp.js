const { sendWhatsApp, sendFreeformWhatsApp } = require('./_lib/whatsapp');
const { cors, parseBody } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = await parseBody(req);
  const { phone, template, params, message } = body;

  if (!phone) return res.status(400).json({ error: 'missing phone' });

  let result;
  if (template) {
    result = await sendWhatsApp(phone, template, params || []);
  } else if (message) {
    result = await sendFreeformWhatsApp(phone, message);
  } else {
    return res.status(400).json({ error: 'missing template or message' });
  }

  return res.status(200).json(result);
};
