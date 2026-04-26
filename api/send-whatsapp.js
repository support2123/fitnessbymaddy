const { sendWhatsApp } = require('./_lib/whatsapp');
const { canSendMessage, logMessage } = require('./_lib/rate-limit');
const { json } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, templateParams, mediaUrl, skipRateLimit } = req.body;

    if (!phone || !templateName) {
      return json(res, 400, { error: 'Missing phone or templateName' });
    }

    if (!skipRateLimit) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return json(res, 429, { error: 'Rate limited — max 1 msg per 2 hrs for leads' });
      }
    }

    const result = await sendWhatsApp(phone, templateName, templateParams || [], mediaUrl);
    await logMessage(phone, 'out', `Template: ${templateName}`, templateName);

    return json(res, result.ok ? 200 : 502, result);
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return json(res, 500, { error: 'Internal error' });
  }
};
