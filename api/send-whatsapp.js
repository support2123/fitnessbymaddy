const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template_name, params } = req.body;

  if (!phone || !template_name) {
    return res.status(400).json({ error: 'Missing phone or template_name' });
  }

  const result = await sendWhatsApp(phone, template_name, params || []);
  return res.status(200).json(result);
};
