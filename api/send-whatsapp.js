const { sendWithRateLimit, sendTemplate, sendText } = require('./_lib/whatsapp');
const { jsonResponse } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const expectedKey = process.env.INTERNAL_API_KEY;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text, skip_rate_limit } = req.body;
    if (!phone) return jsonResponse(res, 400, { error: 'Missing phone' });

    let result;

    if (text) {
      result = await sendText(phone, text);
    } else if (template) {
      if (skip_rate_limit) {
        result = await sendTemplate(phone, template, params || []);
      } else {
        result = await sendWithRateLimit(phone, template, params || []);
      }
    } else {
      return jsonResponse(res, 400, { error: 'Provide template or text' });
    }

    return jsonResponse(res, result.ok ? 200 : 429, result);
  } catch (err) {
    console.error('[Send WA Error]', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
