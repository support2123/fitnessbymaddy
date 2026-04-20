const { sendTemplate, sendText, sendMedia } = require('../lib/whatsapp');
const { jsonResponse } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, 200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'POST only' });

  try {
    const { phone, type, template_name, params, text, media_url, caption } = req.body;

    if (!phone) return jsonResponse(res, 400, { error: 'Missing phone' });

    let result;

    switch (type) {
      case 'template':
        if (!template_name) return jsonResponse(res, 400, { error: 'Missing template_name' });
        result = await sendTemplate(phone, template_name, params || []);
        break;

      case 'text':
        if (!text) return jsonResponse(res, 400, { error: 'Missing text' });
        result = await sendText(phone, text);
        break;

      case 'media':
        if (!media_url) return jsonResponse(res, 400, { error: 'Missing media_url' });
        result = await sendMedia(phone, media_url, caption || '');
        break;

      default:
        return jsonResponse(res, 400, { error: 'type must be template, text, or media' });
    }

    if (!result.ok && result.reason === 'rate_limited') {
      return jsonResponse(res, 429, { error: 'Rate limited — max 1 message per 2hrs for non-clients' });
    }

    return jsonResponse(res, 200, { ok: true, result });
  } catch (err) {
    console.error(`[SEND-WA ERROR] ${err.message}`);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
