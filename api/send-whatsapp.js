const { sendWhatsApp } = require('../lib/whatsapp');
const { parseBody, jsonResp, corsHeaders } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResp(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return jsonResp(res, 401, { error: 'Unauthorized' });
  }

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return jsonResp(res, 400, { error: 'Invalid request body' });
  }

  const { phone, template, params, media_url } = body;
  if (!phone || !template) {
    return jsonResp(res, 400, { error: 'Missing phone or template' });
  }

  const result = await sendWhatsApp(phone, template, params || [], media_url);
  return jsonResp(res, result.ok ? 200 : 429, result);
};
