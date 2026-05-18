const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');
const { json } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return json(res, { error: 'Unauthorized' }, 401);
  }

  try {
    const { phone, template_name, params, freeform_message } = req.body;

    if (!phone) {
      return json(res, { error: 'Missing phone' }, 400);
    }

    let result;
    if (freeform_message) {
      result = await sendFreeformWhatsApp(phone, freeform_message);
    } else if (template_name) {
      result = await sendWhatsApp(phone, template_name, params || {});
    } else {
      return json(res, { error: 'Provide template_name or freeform_message' }, 400);
    }

    return json(res, result);

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
