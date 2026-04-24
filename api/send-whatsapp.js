const { sendTemplate, sendText, canSendMessage } = require('../lib/whatsapp');
const { parseBody, json, cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const body = await parseBody(req);
  const { phone, type, templateName, params, text, isClient } = body;

  if (!phone) return json(res, 400, { error: 'missing phone' });

  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) {
    return json(res, 429, { error: 'rate_limited', message: 'Max 1 message per 2 hours for leads' });
  }

  let result;
  if (type === 'template') {
    result = await sendTemplate(phone, templateName, params);
  } else {
    result = await sendText(phone, text);
  }

  return json(res, 200, { ok: true, result });
};
