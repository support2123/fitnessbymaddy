const { sendWhatsApp } = require('./lib/whatsapp');
const { parseBody, json } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const { phone, template, params } = await parseBody(req);
  if (!phone || !template) {
    return json(res, 400, { error: 'phone and template required' });
  }

  const result = await sendWhatsApp(phone, template, params || []);
  return json(res, 200, result);
};
