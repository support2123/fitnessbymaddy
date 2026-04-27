const { sendWhatsApp } = require('../lib/whatsapp');
const { json } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  // Internal-only: verify internal caller key
  const authHeader = req.headers.authorization || '';
  const internalKey = process.env.INTERNAL_API_KEY;
  if (internalKey && authHeader !== `Bearer ${internalKey}`) {
    return json(res, { error: 'Unauthorized' }, 401);
  }

  try {
    const { phone, templateName, params, body } = req.body;

    if (!phone || !templateName) {
      return json(res, { error: 'Missing phone or templateName' }, 400);
    }

    const result = await sendWhatsApp({ phone, templateName, params, body });

    if (result.rateLimited) {
      return json(res, { error: 'Rate limited — 2hr gap not met for non-client' }, 429);
    }

    return json(res, result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
