const { sendWhatsApp, canSendMessage } = require('../lib/whatsapp');
const { maskPhone, jsonResponse, handleCors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
      return jsonResponse(res, { error: 'Unauthorized' }, 401);
    }

    const { phone, template_name, params, force } = req.body;

    if (!phone || !template_name) {
      return jsonResponse(res, { error: 'phone and template_name required' }, 400);
    }

    if (!force) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return jsonResponse(res, {
          error: 'Rate limited — max 1 message per 2 hours',
          phone: maskPhone(phone)
        }, 429);
      }
    }

    const result = await sendWhatsApp(phone, template_name, params || []);
    return jsonResponse(res, { success: result.ok, phone: maskPhone(phone) });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return jsonResponse(res, { error: 'Internal error' }, 500);
  }
};
