const { sendWhatsApp } = require('../lib/whatsapp');
const { parseBody, cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = await parseBody(req);
    const { phone, template, params, text } = body;

    if (!phone || !template) {
      return res.status(400).json({ error: 'phone and template required' });
    }

    const result = await sendWhatsApp(phone, template, params || {}, text || '');
    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('[Send WhatsApp] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
