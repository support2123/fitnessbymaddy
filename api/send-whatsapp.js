const { sendTemplate, sendFreeform } = require('./lib/whatsapp');
const { parseBody, corsHeaders, json } = require('./lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return json(res, { error: 'unauthorized' }, 401);
  }

  try {
    const body = await parseBody(req);
    const { phone, template, params, text, is_client } = body;

    if (!phone) return json(res, { error: 'phone required' }, 400);
    const isClient = is_client === true || is_client === 'true';

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || [], isClient);
    } else if (text) {
      result = await sendFreeform(phone, text, isClient);
    } else {
      return json(res, { error: 'template or text required' }, 400);
    }

    return json(res, result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return json(res, { error: 'internal' }, 500);
  }
};
