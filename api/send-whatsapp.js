const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');
const { json, cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return json(res, { error: 'Unauthorized' }, 401);
  }

  try {
    const { phone, template_name, body_values, media_url, freeform_message } = req.body || {};

    if (!phone) return json(res, { error: 'phone required' }, 400);

    let result;
    if (freeform_message) {
      const ok = await sendFreeformWhatsApp(phone, freeform_message);
      result = { ok };
    } else if (template_name) {
      result = await sendWhatsApp(phone, template_name, body_values, media_url);
    } else {
      return json(res, { error: 'template_name or freeform_message required' }, 400);
    }

    if (result.rateLimited) {
      return json(res, { error: 'Rate limited: max 1 msg per 2 hrs for non-clients' }, 429);
    }

    return json(res, { ok: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
