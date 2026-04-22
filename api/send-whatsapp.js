const { sendWhatsApp } = require('./_lib/whatsapp');
const { parseBody, cors, json } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const { phone, message, templateName, templateParams } = body;

  if (!phone) return json(res, 400, { error: 'phone required' });
  if (!message && !templateName) return json(res, 400, { error: 'message or templateName required' });

  const result = await sendWhatsApp({
    phone,
    body: message,
    templateName,
    templateParams,
  });

  return json(res, result.ok ? 200 : 429, result);
};
