const { sendWhatsApp } = require('./_lib/whatsapp');
const { corsHeaders, parseBody } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const { phone, message, template } = body;

  if (!phone || !message) {
    return res.status(400).json({ error: 'phone and message required' });
  }

  const result = await sendWhatsApp(phone, message, template);
  return res.status(200).json(result);
};
