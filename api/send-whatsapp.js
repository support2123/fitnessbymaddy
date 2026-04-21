const { canSendMessage, sendTemplate, sendFreeformMessage, sendMediaMessage } = require('../lib/whatsapp');
const { sendJson, parseBody } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  try {
    const body = await parseBody(req);
    const { phone, template, params, message, media_url, caption, is_client } = body;

    if (!phone) return sendJson(res, 400, { error: 'phone required' });

    const allowed = await canSendMessage(phone, !!is_client);
    if (!allowed) {
      return sendJson(res, 429, { error: 'Rate limited — max 1 message per 2 hours for leads' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (media_url) {
      result = await sendMediaMessage(phone, media_url, caption);
    } else if (message) {
      result = await sendFreeformMessage(phone, message);
    } else {
      return sendJson(res, 400, { error: 'template, message, or media_url required' });
    }

    return sendJson(res, result.ok ? 200 : 502, result);
  } catch (err) {
    console.error('[SEND-WA] Error:', err.message);
    return sendJson(res, 500, { error: 'Internal error' });
  }
};
