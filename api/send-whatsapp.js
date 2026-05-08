const { sendTemplate, sendText, canSendMessage, maskPhone } = require('../lib/whatsapp');
const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, template, params, text, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });
    if (!template && !text) return res.status(400).json({ error: 'Missing template or text' });

    const { data: client } = await supabase
      .from('clients')
      .select('status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    const isClient = !!client;

    if (!force && !(await canSendMessage(phone, isClient))) {
      return res.status(429).json({
        error: 'Rate limited',
        message: `Cannot send to ${maskPhone(phone)} — wait 2 hours between messages to non-clients`,
      });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else {
      result = await sendText(phone, text);
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
