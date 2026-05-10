const { sendTemplate, sendText, canSendToLead } = require('../lib/whatsapp');
const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const authHeader = req.headers['authorization'] || '';
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, type, template_name, text, params, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('status')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (lead && lead.length > 0 && lead[0].status === 'dropped') {
      return res.status(403).json({ error: 'Lead opted out — cannot send' });
    }

    if (!force) {
      const allowed = await canSendToLead(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
      }
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template_name or text' });
    }

    return res.json({ success: true, result });

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
