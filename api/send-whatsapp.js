const { sendWhatsApp, normalizePhone } = require('./lib/whatsapp');
const { handleCors, jsonError, jsonOk } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return jsonError(res, 'POST only', 405);

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return jsonError(res, 'Unauthorized', 401);
  }

  const { phone, template, params, skipRateLimit } = req.body || {};
  if (!phone || !template) return jsonError(res, 'phone and template required');

  const normalized = normalizePhone(phone);
  const result = await sendWhatsApp(normalized, template, params || [], !!skipRateLimit);

  if (!result.success) {
    return res.status(429).json({ error: result.reason });
  }

  return jsonOk(res, { sent: true });
};
