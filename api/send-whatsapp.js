const { sendWhatsApp, sendWhatsAppForced } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, message, template_name, force } = req.body;
    if (!phone || (!message && !template_name)) {
      return res.status(400).json({ error: 'Missing phone or message/template' });
    }

    const result = force
      ? await sendWhatsAppForced(phone, message, template_name)
      : await sendWhatsApp(phone, message, template_name);

    return res.json({ success: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
