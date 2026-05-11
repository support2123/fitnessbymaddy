const { sendTemplate, sendText, canSendMessage } = require('../lib/whatsapp');
const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, type, template_name, params, text } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    const isClient = !!client;

    const allowed = await canSendMessage(phone, isClient);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited: max 1 message per 2hrs for non-clients' });
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'text' && text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Specify type=template with template_name, or type=text with text' });
    }

    return res.status(200).json({ success: true, result });

  } catch (err) {
    console.error('[send-whatsapp]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
