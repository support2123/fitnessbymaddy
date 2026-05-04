const { canSendMessage, sendTemplate, sendText, maskPhone } = require('./lib/whatsapp');
const { parseBody, corsHeaders, json, normalizePhone } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { phone: rawPhone, template, params, text, force } = body;

    if (!rawPhone) return json(res, 400, { error: 'phone required' });

    const phone = normalizePhone(rawPhone);

    if (!force) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return json(res, 429, {
          error: 'Rate limited — max 1 message per 2 hours for this number',
          phone: maskPhone(phone)
        });
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return json(res, 400, { error: 'template or text required' });
    }

    return json(res, 200, { ok: true, result });

  } catch (err) {
    console.error('Send WA error:', err.message);
    return json(res, 500, { error: 'Failed to send' });
  }
};
