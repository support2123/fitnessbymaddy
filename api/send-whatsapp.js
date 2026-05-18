const { sendWhatsApp } = require('./_lib/whatsapp');
const { jsonResponse, errorResponse } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  const { phone, template, params, mediaUrl } = req.body || {};
  if (!phone || !template) {
    return errorResponse(res, 'phone and template required');
  }

  const result = await sendWhatsApp(phone, template, params || [], mediaUrl || null);
  return jsonResponse(res, result);
};
