const { canSendMessage, sendTemplate, sendTextMessage, maskPhone } = require('../lib/whatsapp');
const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, template_name, params, text, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    if (!force) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return res.status(429).json({
          error: 'Rate limited — max 1 message per 2 hours for non-clients',
          phone: maskPhone(phone)
        });
      }
    }

    const db = getSupabase();
    const { data: lead } = await db
      .from('leads')
      .select('status')
      .eq('phone', phone)
      .single();

    if (lead?.status === 'dropped') {
      return res.status(403).json({ error: 'Contact opted out' });
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (text) {
      result = await sendTextMessage(phone, text);
    } else {
      return res.status(400).json({ error: 'template_name or text required' });
    }

    return res.json(result);

  } catch (err) {
    console.error('[send-whatsapp] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
