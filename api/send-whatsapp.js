const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, sendTextMessage } = require('../lib/whatsapp');
const { json, parseBody } = require('../lib/utils');

const rateLimitMap = new Map();

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, { ok: true });
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return json(res, { error: 'unauthorized' }, 401);
  }

  const body = await parseBody(req);
  const { phone, template, text, params, is_client } = body;

  if (!phone) return json(res, { error: 'phone required' }, 400);
  if (!template && !text) return json(res, { error: 'template or text required' }, 400);

  // Rate limiting: max 1 outbound per lead per 2 hours (clients exempt)
  if (!is_client) {
    const lastSent = rateLimitMap.get(phone);
    const twoHoursMs = 2 * 60 * 60 * 1000;
    if (lastSent && Date.now() - lastSent < twoHoursMs) {
      return json(res, { error: 'rate_limited', retry_after_ms: twoHoursMs - (Date.now() - lastSent) }, 429);
    }
  }

  let result;
  if (template) {
    result = await sendWhatsApp(phone, template, {
      name: params?.name || 'there',
      templateParams: params?.templateParams || [],
      media: params?.media,
    });
  } else {
    result = await sendTextMessage(phone, text);
  }

  rateLimitMap.set(phone, Date.now());

  return json(res, { ok: true, result });
};
