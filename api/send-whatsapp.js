const { sendTemplate, sendFreeform, maskPhone } = require('./lib/whatsapp');
const { canSendTo, logMessage } = require('./lib/rate-limit');
const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template_name, params, message, force } = req.body || {};

  if (!phone) return res.status(400).json({ error: 'phone required' });
  if (!template_name && !message) {
    return res.status(400).json({ error: 'template_name or message required' });
  }

  const db = getSupabase();
  const { data: dropped } = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'dropped')
    .single();

  if (dropped) {
    return res.status(403).json({ error: 'Contact opted out', phone: maskPhone(phone) });
  }

  if (!force) {
    const allowed = await canSendTo(phone);
    if (!allowed) {
      return res.status(429).json({
        error: 'Rate limited — max 1 message per 2 hours',
        phone: maskPhone(phone),
      });
    }
  }

  let result;
  if (template_name) {
    result = await sendTemplate(phone, template_name, params || []);
    await logMessage(phone, 'out', `Template: ${template_name}`, template_name);
  } else {
    result = await sendFreeform(phone, message);
    await logMessage(phone, 'out', message, null);
  }

  return res.status(result.success ? 200 : 502).json(result);
};
