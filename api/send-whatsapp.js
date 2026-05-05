const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Internal-only: check for auth header
  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, params, mediaUrl } = req.body;

  if (!phone || !templateName) {
    return res.status(400).json({ error: 'Missing phone or templateName' });
  }

  const result = await sendWhatsApp({ phone, templateName, params, mediaUrl });
  return res.status(200).json(result);
};
