const { canSendToLead, sendTemplate, sendText } = require('./_lib/whatsapp');
const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  const expectedKey = process.env.INTERNAL_API_KEY;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    if (!force) {
      const { data: lead } = await supabase
        .from('leads')
        .select('status')
        .eq('phone', phone)
        .single();

      if (lead && lead.status === 'dropped') {
        return res.json({ status: 'skipped', reason: 'lead_opted_out' });
      }

      const isClient = await isActiveClient(phone);
      if (!isClient) {
        const allowed = await canSendToLead(phone);
        if (!allowed) {
          return res.json({ status: 'skipped', reason: 'rate_limited' });
        }
      }
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'text' && text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template_name, or type=text with text' });
    }

    return res.json({ status: result.ok ? 'sent' : 'failed', data: result });
  } catch (err) {
    console.error('[SendWA Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function isActiveClient(phone) {
  const { data } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);
  return data && data.length > 0;
}
