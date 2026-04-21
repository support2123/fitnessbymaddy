const { sendTemplate, sendFreeform } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, message } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone is required' });

  let result;
  if (template) {
    result = await sendTemplate(phone, template, params || []);
  } else if (message) {
    result = await sendFreeform(phone, message);
  } else {
    return res.status(400).json({ error: 'template or message is required' });
  }

  return res.status(result.success ? 200 : 429).json(result);
};
