const supabase = require('../lib/supabase');
const { normalizePhone } = require('../lib/phone');
const { sendTemplate, sendSessionMessage, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, template_name, params, body, force } = req.body;
    const normalized = normalizePhone(phone);

    if (!normalized) return res.status(400).json({ error: 'Phone required' });

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', normalized)
      .eq('status', 'active')
      .maybeSingle();

    const isClient = !!client;

    if (!force) {
      const allowed = await canSendMessage(normalized, isClient);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for non-clients' });
      }
    }

    let result;
    if (template_name) {
      result = await sendTemplate(normalized, template_name, params || []);
    } else if (body) {
      result = await sendSessionMessage(normalized, body);
    } else {
      return res.status(400).json({ error: 'template_name or body required' });
    }

    return res.status(result.ok ? 200 : 502).json(result);

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
