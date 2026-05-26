const { sendTemplate, sendTextMessage } = require('../lib/whatsapp');
const { jsonResponse, errorResponse, handleOptions, normalizePhone } = require('../lib/utils');

module.exports = async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const { phone, template, params, text } = await req.json();

    if (!phone) return errorResponse('Missing phone');

    const normalized = normalizePhone(phone);

    let result;
    if (template) {
      result = await sendTemplate(normalized, template, params || []);
    } else if (text) {
      result = await sendTextMessage(normalized, text);
    } else {
      return errorResponse('Provide template or text');
    }

    return jsonResponse(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return errorResponse('Internal error', 500);
  }
};
