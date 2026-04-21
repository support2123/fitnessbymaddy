const { supabase } = require('../lib/supabase');
const { sendTemplate, sendTextMessage, sendMediaMessage, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, type, template_name, params, text, media_url } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    const isClient = !!client;
    const allowed = await canSendMessage(phone, isClient);

    if (!allowed) {
      return res.status(429).json({
        error: 'Rate limited — max 1 outbound per 2 hours for non-clients',
      });
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'media' && media_url) {
      result = await sendMediaMessage(phone, text || '', media_url);
    } else if (text) {
      result = await sendTextMessage(phone, text);
    } else {
      return res.status(400).json({ error: 'Must provide template_name, text, or media_url' });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
