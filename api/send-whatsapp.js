const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, body, params } = req.body;

    if (!phone || !template_name) {
      return res.status(400).json({ error: 'Missing phone or template_name' });
    }

    const result = await sendWhatsApp({
      phone,
      templateName: template_name,
      body: body || template_name,
      params: params || []
    });

    return res.status(result.success ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
