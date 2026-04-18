const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, template, params } = req.body;

    if (!phone || !template) {
      return res.status(400).json({ error: 'Missing phone or template' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const result = await sendWhatsApp(cleanPhone, template, params || []);

    if (result.rateLimited) {
      return res.status(429).json({ error: 'Rate limited', retry_after: '2h' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
