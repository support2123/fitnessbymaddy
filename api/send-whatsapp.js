const { sendTemplate, sendClientMessage, canSend } = require('../lib/whatsapp');
const supabase = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Internal-only endpoint — verify with a simple shared secret
  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, user_name, is_client } = req.body;

    if (!phone || !template_name) {
      return res.status(400).json({ error: 'phone and template_name are required' });
    }

    let result;
    if (is_client) {
      result = await sendClientMessage(phone, template_name, params || [], user_name);
    } else {
      result = await sendTemplate(phone, template_name, params || [], user_name);
    }

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
