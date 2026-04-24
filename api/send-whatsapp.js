const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText } = require('./lib/whatsapp');
const { canSendToLead } = require('./lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, template_name, params, message, force } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' });
  }

  if (!force) {
    const allowed = await canSendToLead(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
    }
  }

  try {
    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (message) {
      result = await sendText(phone, message);
    } else {
      return res.status(400).json({ error: 'Provide template_name or message' });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
