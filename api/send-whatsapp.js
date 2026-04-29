const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');
const { sendJson, sendError, corsHeaders } = require('../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return sendError(res, 405, 'POST only');

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return sendError(res, 401, 'Unauthorized');
  }

  const { phone, template, params, message, mediaUrl } = req.body || {};
  if (!phone) return sendError(res, 400, 'Missing phone');

  if (template) {
    const result = await sendWhatsApp(phone, template, params || [], mediaUrl);
    return sendJson(res, result.skipped ? 429 : 200, result);
  }

  if (message) {
    const result = await sendFreeformWhatsApp(phone, message);
    return sendJson(res, 200, result);
  }

  return sendError(res, 400, 'Provide template or message');
};
