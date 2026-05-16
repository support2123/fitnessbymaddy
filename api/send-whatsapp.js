const { sendTemplate, sendTextMessage } = require('./lib/whatsapp');
const { canSendMessage, logMessage } = require('./lib/rate-limit');
const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phone, template, params, text, force } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' });
  }

  const db = getSupabase();
  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  const isClient = !!client;
  const allowed = force || await canSendMessage(phone, isClient);

  if (!allowed) {
    return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
  }

  let result;
  if (template) {
    result = await sendTemplate(phone, template, params || []);
    await logMessage(phone, 'out', `[Template: ${template}]`, template);
  } else if (text) {
    result = await sendTextMessage(phone, text);
    await logMessage(phone, 'out', text);
  } else {
    return res.status(400).json({ error: 'template or text required' });
  }

  return res.status(200).json({ sent: true, result });
};
