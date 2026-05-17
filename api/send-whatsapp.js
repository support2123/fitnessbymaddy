const { sendTemplate, sendText, maskPhone } = require('./lib/whatsapp');
const { canSendMessage, logMessage } = require('./lib/rate-limit');
const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, template, params, text, force } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const supabase = getSupabase();
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    const isClient = !!client;
    const allowed = force || await canSendMessage(phone, isClient);

    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for non-clients' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
      await logMessage(phone, 'out', null, template);
    } else if (text) {
      result = await sendText(phone, text);
      await logMessage(phone, 'out', text, null);
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
