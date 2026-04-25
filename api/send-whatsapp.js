const { sendWhatsApp, canSendTo } = require('./_lib/whatsapp');
const { corsHeaders } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers['authorization'];
  if (!auth || auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, bodyValues, mediaUrl, skipRateLimit } = req.body;

    if (!phone || !templateName) {
      return res.status(400).json({ error: 'phone and templateName required' });
    }

    if (!skipRateLimit) {
      const allowed = await canSendTo(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited: 1 message per 2 hours' });
      }
    }

    const result = await sendWhatsApp({
      phone,
      templateName,
      bodyValues: bodyValues || [],
      mediaUrl: mediaUrl || null,
    });

    return res.json(result);
  } catch (err) {
    console.error('[SendWA] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
