const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');
const { json, cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, { error: 'Unauthorized' }, 401);
  }

  try {
    const { phone, template, params, message, media_url } = req.body;

    if (!phone) return json(res, { error: 'phone required' }, 400);

    let result;
    if (template) {
      result = await sendWhatsApp(phone, template, params || [], media_url);
    } else if (message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else {
      return json(res, { error: 'template or message required' }, 400);
    }

    return json(res, result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
