const { sendTemplate, sendText } = require('../lib/whatsapp');
const { jsonResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, {}, 200);
  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return jsonResponse(res, { error: 'Unauthorized' }, 401);
  }

  const { phone, template, params, text } = req.body || {};
  if (!phone) return jsonResponse(res, { error: 'phone required' }, 400);

  let result;
  if (template) {
    result = await sendTemplate(phone, template, params);
  } else if (text) {
    result = await sendText(phone, text);
  } else {
    return jsonResponse(res, { error: 'template or text required' }, 400);
  }

  return jsonResponse(res, { ok: true, result });
};
