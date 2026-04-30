const { sendTemplate, sendText, sendMedia } = require('../lib/whatsapp');
const { jsonResponse, errorResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return errorResponse(res, 'Method not allowed', 405);

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  try {
    const { phone, type, template_name, params, text, media_url, caption } = req.body;

    if (!phone) return errorResponse(res, 'Phone required');

    let result;

    switch (type) {
      case 'template':
        if (!template_name) return errorResponse(res, 'template_name required');
        result = await sendTemplate(phone, template_name, params || []);
        break;

      case 'text':
        if (!text) return errorResponse(res, 'text required');
        result = await sendText(phone, text);
        break;

      case 'media':
        if (!media_url) return errorResponse(res, 'media_url required');
        result = await sendMedia(phone, media_url, caption);
        break;

      default:
        return errorResponse(res, 'type must be template, text, or media');
    }

    if (result === null) {
      return jsonResponse(res, { status: 'blocked', reason: 'opted_out_or_rate_limited' });
    }

    return jsonResponse(res, { status: 'sent', result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};
