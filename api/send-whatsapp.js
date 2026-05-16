const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, freeform, message } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (freeform && message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else if (template) {
      result = await sendWhatsApp(phone, template, params || {});
    } else {
      return res.status(400).json({ error: 'Missing template or freeform message' });
    }

    return res.json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
