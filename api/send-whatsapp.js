const { sendWhatsApp, sendWhatsAppUnlimited } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  const expected = `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`;
  if (authHeader !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { phone, template, message, media_url, skip_rate_limit } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (!template && !message) return res.status(400).json({ error: 'template or message required' });

    const sender = skip_rate_limit ? sendWhatsAppUnlimited : sendWhatsApp;
    const result = await sender(phone, template || null, message || null, media_url || null);

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
