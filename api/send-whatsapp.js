const { sendAndLog, canSendMessage } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params = [], is_client = false } = req.body;

    if (!phone || !template_name) {
      return res.status(400).json({ error: 'Missing phone or template_name' });
    }

    const allowed = await canSendMessage(phone, is_client);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited', retry_after: '2h' });
    }

    const result = await sendAndLog(phone, template_name, params, is_client);
    return res.status(200).json({ success: true, result });

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
