const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, params, message } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'phone required' });
  }

  const result = await sendWhatsApp({ phone, templateName, params, message });

  if (result.throttled) {
    return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for non-clients' });
  }

  return res.status(200).json(result);
};
