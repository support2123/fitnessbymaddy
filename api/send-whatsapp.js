const { sendWhatsApp } = require('../lib/whatsapp');
const { normalizePhone } = require('../lib/phone');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template_name, params, body } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (!template_name && !body) return res.status(400).json({ error: 'template_name or body required' });

    const result = await sendWhatsApp({
      phone: normalizePhone(phone),
      templateName: template_name,
      params,
      body
    });

    return res.status(result.ok ? 200 : 429).json(result);

  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
