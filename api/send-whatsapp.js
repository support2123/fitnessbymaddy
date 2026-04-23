const { sendTemplate, sendTextMessage, canSendMessage } = require('./lib/whatsapp');
const { corsHeaders, json, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const { phone, template, params, text, is_client } = body;

    if (!phone) return json(res, 400, { error: 'Missing phone' });

    const canSend = await canSendMessage(phone, !!is_client);
    if (!canSend) {
      return json(res, 429, { error: 'Rate limited: max 1 message per 2 hours for non-clients' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendTextMessage(phone, text);
    } else {
      return json(res, 400, { error: 'Provide template or text' });
    }

    return json(res, result.ok ? 200 : 502, result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return json(res, 500, { error: 'Internal server error' });
  }
};
