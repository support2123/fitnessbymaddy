const { normalizePhone, maskPhone } = require('../lib/helpers');
const { canSend, sendTemplate, sendText, sendMediaMessage } = require('../lib/whatsapp');
const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone: rawPhone, type, template_name, params, text, media_url, caption, force } = req.body;

    if (!rawPhone) return res.status(400).json({ error: 'phone required' });
    const phone = normalizePhone(rawPhone);

    // Check if client or lead for rate limiting
    const db = getSupabase();
    const { data: client } = await db
      .from('clients').select('id').eq('phone', phone).eq('status', 'active').single();
    const isClient = !!client;

    if (!force && !await canSend(phone, isClient)) {
      return res.status(429).json({ error: 'Rate limited', phone: maskPhone(phone) });
    }

    let result;
    switch (type) {
      case 'template':
        if (!template_name) return res.status(400).json({ error: 'template_name required' });
        result = await sendTemplate(phone, template_name, params || []);
        break;
      case 'text':
        if (!text) return res.status(400).json({ error: 'text required' });
        result = await sendText(phone, text);
        break;
      case 'media':
        if (!media_url) return res.status(400).json({ error: 'media_url required' });
        result = await sendMediaMessage(phone, media_url, caption);
        break;
      default:
        return res.status(400).json({ error: 'type must be template, text, or media' });
    }

    return res.json({ ok: result.ok, phone: maskPhone(phone) });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
