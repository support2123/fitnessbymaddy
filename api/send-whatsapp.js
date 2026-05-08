const { sendWhatsApp } = require('../lib/whatsapp');
const { corsHeaders } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).set(corsHeaders()).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, body_values, media_url } = req.body;

    if (!phone || !template_name) {
      return res.status(400).json({ error: 'phone and template_name required' });
    }

    const result = await sendWhatsApp(phone, template_name, body_values || [], media_url);

    res.set(corsHeaders());
    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
