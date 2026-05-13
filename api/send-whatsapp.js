const { sendWhatsApp, sendTextMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, body, params } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  if (body && !templateName) {
    const result = await sendTextMessage(phone, body);
    return res.status(result.ok ? 200 : 429).json(result);
  }

  if (!templateName) return res.status(400).json({ error: 'templateName or body required' });

  const result = await sendWhatsApp({ phone, templateName, body, params });
  return res.status(result.ok ? 200 : 429).json(result);
};
