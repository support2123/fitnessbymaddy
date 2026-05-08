const { supabase } = require('./lib/supabase');
const { sendTemplate, sendText, sendDocument } = require('./lib/whatsapp');
const { canSendTo } = require('./lib/rate-limiter');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, document_url, caption, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (!force && !(await canSendTo(phone, !!client))) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for leads' });
    }

    let result;
    switch (type) {
      case 'template':
        result = await sendTemplate(phone, template_name, params || []);
        break;
      case 'text':
        result = await sendText(phone, text);
        break;
      case 'document':
        result = await sendDocument(phone, document_url, caption || '');
        break;
      default:
        return res.status(400).json({ error: 'Invalid type — use template, text, or document' });
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
