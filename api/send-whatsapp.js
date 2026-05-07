const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, body, template_name, skip_rate_limit } = req.body;
  if (!phone || (!body && !template_name)) {
    return res.status(400).json({ error: 'phone and body/template_name required' });
  }

  const result = await sendWhatsApp(phone, body, template_name, !!skip_rate_limit);
  return res.status(200).json(result);
};
