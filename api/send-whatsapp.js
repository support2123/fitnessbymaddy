const { sendTemplate, sendText, sendMedia } = require('../lib/whatsapp');
const { canSendMessage } = require('../lib/rate-limit');
const { maskPhone } = require('../lib/mask-phone');
const { supabase } = require('../lib/supabase');

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
      return res.status(400).json({ error: 'phone is required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    const isClient = !!client;
    const allowed = await canSendMessage(phone, isClient);

    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for non-clients' });
    }

    let result;

    if (type === 'template') {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'media') {
      result = await sendMedia(phone, media_url, caption || '');
    } else {
      result = await sendText(phone, text || '');
    }

    return res.status(result.ok ? 200 : 502).json(result);

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
