const { sendRateLimited, sendTemplate, logMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, body, force } = req.body;

    if (!phone || !template_name) {
      return res.status(400).json({ error: 'phone and template_name required' });
    }

    if (force) {
      const result = await sendTemplate(phone, template_name, params || []);
      await logMessage(phone, 'out', body || template_name, template_name);
      return res.status(200).json({ success: true, result });
    }

    const result = await sendRateLimited(phone, template_name, params || [], body);

    if (!result.success) {
      return res.status(429).json({ error: 'Rate limited', reason: result.reason });
    }

    return res.status(200).json({ success: true, result: result.result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
