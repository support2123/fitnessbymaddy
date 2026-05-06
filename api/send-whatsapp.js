const { sendTemplate } = require('./lib/whatsapp');
const { canSendMessage, logMessage } = require('./lib/ratelimit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, is_client } = req.body;

    if (!phone || !template_name) {
      return res.status(400).json({ error: 'phone and template_name required' });
    }

    const allowed = await canSendMessage(phone, is_client);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — 1 msg per 2hrs for leads' });
    }

    await sendTemplate(phone, template_name, params || {});
    await logMessage(phone, 'out', `Template: ${template_name}`, template_name);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Send WhatsApp error:', err);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
