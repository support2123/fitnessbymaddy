const { sendTemplate, sendText, canSendToLead } = require('../lib/whatsapp');
const { supabase } = require('../lib/supabase');
const { cors, maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, params, message, forceBypassRateLimit } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone is required' });

  if (!forceBypassRateLimit) {
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) {
      const allowed = await canSendToLead(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited: max 1 message per 2hrs for non-clients' });
      }
    }
  }

  let result;
  if (type === 'template') {
    if (!templateName) return res.status(400).json({ error: 'templateName required for template type' });
    result = await sendTemplate(phone, templateName, params || []);
  } else {
    if (!message) return res.status(400).json({ error: 'message required for text type' });
    result = await sendText(phone, message);
  }

  if (result.ok) {
    return res.status(200).json({ success: true });
  }
  return res.status(502).json({ error: 'Failed to send WhatsApp', details: result.data });
};
