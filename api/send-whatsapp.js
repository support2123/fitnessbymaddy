const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization || '';
    const expected = `Bearer ${process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_KEY}`;
    if (authHeader !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template_name, params, media_url } = req.body;

    if (!phone || !template_name) {
      return res.status(400).json({ error: 'Missing phone or template_name' });
    }

    const result = await sendWhatsApp(phone, template_name, params || [], media_url);

    if (result.rateLimited) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2hrs for non-clients' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
