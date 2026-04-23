const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, body, template_name, params } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (!body && !template_name) return res.status(400).json({ error: 'body or template_name required' });

    const result = await sendWhatsApp({
      phone,
      body,
      templateName: template_name,
      params
    });

    return res.json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
