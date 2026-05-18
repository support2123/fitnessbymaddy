const { sendWhatsApp, sendFreeformWhatsApp, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template, params, message, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;

    if (template) {
      result = await sendWhatsApp(phone, template, params || [], media_url);
    } else if (message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'Provide template or message' });
    }

    return res.json({
      success: result.ok,
      phone: maskPhone(phone),
      ...(result.reason && { reason: result.reason }),
    });
  } catch (err) {
    console.error('[send-whatsapp]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
