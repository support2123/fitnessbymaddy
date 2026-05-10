const { canSendMessage, sendTemplate, sendTextMessage } = require('./_lib/whatsapp');
const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const authHeader = req.headers.authorization || '';
    const expectedKey = process.env.SUPABASE_SERVICE_KEY;
    if (!authHeader.includes(expectedKey)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template_name, params, text } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const db = getSupabase();
    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    const isClient = !!client;

    if (!(await canSendMessage(phone, isClient))) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for non-clients' });
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (text) {
      result = await sendTextMessage(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template_name or text' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
