const { sendTemplate, sendText, canSendToLead } = require('../lib/whatsapp');
const { getClient } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, template_name, params, text, force } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    if (!template_name && !text) {
      return res.status(400).json({ error: 'template_name or text required' });
    }

    const db = getClient();

    const { data: lead } = await db
      .from('leads')
      .select('status')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead && lead.status === 'dropped') {
      return res.status(403).json({ error: 'Contact has opted out' });
    }

    if (!force) {
      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .limit(1)
        .single();

      if (!client) {
        const allowed = await canSendToLead(phone);
        if (!allowed) {
          return res.status(429).json({ error: 'Rate limit: max 1 message per 2 hours for leads' });
        }
      }
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else {
      result = await sendText(phone, text);
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
