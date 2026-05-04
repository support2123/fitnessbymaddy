const { sendTemplate } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ') || authHeader.slice(7) !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template_name, params } = req.body;

  if (!phone || !template_name) {
    return res.status(400).json({ error: 'phone and template_name required' });
  }

  const result = await sendTemplate(phone, template_name, params || {});

  if (result.rateLimited) {
    return res.status(429).json({ error: 'Rate limited', detail: 'Max 1 msg per 2 hrs for non-clients' });
  }

  return res.status(200).json({ success: true, result });
};
