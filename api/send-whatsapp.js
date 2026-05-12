const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ') || authHeader.slice(7) !== process.env.SUPABASE_SERVICE_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template, params, media_url } = req.body || {};

    if (!phone || !template) {
      return res.status(400).json({ error: 'phone and template required' });
    }

    const result = await sendWhatsApp(phone, template, params || [], media_url || null);

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
