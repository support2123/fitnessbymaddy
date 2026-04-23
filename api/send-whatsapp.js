const { canSendToLead, sendTemplate, sendText } = require('./lib/whatsapp');
const { normalizePhone, cors, parseBody } = require('./lib/helpers');
const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { phone: rawPhone, template, params, text, force } = body;

    if (!rawPhone) return res.status(400).json({ error: 'Missing phone' });
    const phone = normalizePhone(rawPhone);

    if (!force) {
      const sb = getSupabase();
      const { data: client } = await sb
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .maybeSingle();

      if (!client) {
        const allowed = await canSendToLead(phone);
        if (!allowed) {
          return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
        }
      }
    }

    let status;
    if (template) {
      status = await sendTemplate(phone, template, params || []);
    } else if (text) {
      status = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    return res.status(200).json({ success: status === 'sent', status });

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
