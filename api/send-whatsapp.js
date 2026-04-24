const { canSendMessage, sendTemplate, sendText } = require('../lib/whatsapp');
const { corsHeaders } = require('../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const allowed = await canSendMessage(phone, !!is_client);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for non-clients' });
    }

    let status;
    if (type === 'template' && template_name) {
      status = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'text' && text) {
      status = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template_name, or type=text with text' });
    }

    return res.status(200).json({ status });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
