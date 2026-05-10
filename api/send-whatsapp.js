const { sendTemplate, sendText, sendMediaMessage, checkRateLimit } = require('../lib/whatsapp');
const supabase = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, media_url, caption } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    const isClient = !!client;

    const canSend = await checkRateLimit(phone, isClient);
    if (!canSend) {
      return res.status(429).json({ error: 'Rate limited — last message sent within 2 hours' });
    }

    let result;

    switch (type) {
      case 'template':
        result = await sendTemplate(phone, template_name, params || []);
        break;
      case 'text':
        result = await sendText(phone, text);
        break;
      case 'media':
        result = await sendMediaMessage(phone, media_url, caption);
        break;
      default:
        return res.status(400).json({ error: 'Invalid type — use template, text, or media' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
