const { sendWhatsApp } = require('../lib/whatsapp');
const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, message, template_name } = req.body;
  if (!phone) return res.status(400).json({ error: 'Missing phone' });
  if (!message && !template_name) return res.status(400).json({ error: 'Missing message or template_name' });

  const result = await sendWhatsApp(phone, message || null, template_name || null);
  return res.json(result);
};
