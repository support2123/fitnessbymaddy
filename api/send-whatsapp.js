const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendSession, canSendMessage } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, force } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const { data: client } = await supabase.from('clients')
      .select('id').eq('phone', phone).eq('status', 'active').limit(1).single();
    const isClient = !!client;

    if (!force) {
      const allowed = await canSendMessage(phone, isClient);
      if (!allowed) {
        return res.status(429).json({
          error: 'Rate limited',
          detail: `Max 1 msg per 2hrs for non-clients. Phone: ${maskPhone(phone)}`
        });
      }
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'session' && text) {
      result = await sendSession(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template_name, or type=session with text' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
