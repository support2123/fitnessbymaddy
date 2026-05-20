const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, text, name, isClient, mediaUrl, templateParams } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const result = await sendWhatsApp(phone, template || null, {
      text,
      name,
      isClient: !!isClient,
      mediaUrl,
      templateParams
    });

    return res.status(result.sent ? 200 : 429).json(result);
  } catch (err) {
    console.error('[SendWA] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
