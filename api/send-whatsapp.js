const { sendTemplate, sendFreeform } = require('../lib/whatsapp');
const { jsonResponse, errorResponse } = require('../lib/utils');

module.exports = async function handler(req) {
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await req.json();
  const { phone, templateName, message, params } = body;

  if (!phone) return errorResponse('Missing phone');

  let result;
  if (templateName) {
    result = await sendTemplate(phone, templateName, params || {});
  } else if (message) {
    result = await sendFreeform(phone, message, params?.isClient);
  } else {
    return errorResponse('Provide templateName or message');
  }

  return jsonResponse(result);
};
