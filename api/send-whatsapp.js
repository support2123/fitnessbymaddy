const { sendTemplate, sendText, checkRateLimit } = require('../lib/whatsapp');
const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.AISENSY_API_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template, params, text, bypass_rate_limit } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!bypass_rate_limit) {
      const limited = await checkRateLimit(phone);
      if (limited) {
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('phone', phone)
          .eq('status', 'active')
          .limit(1);

        if (!client || client.length === 0) {
          return res.status(429).json({ error: 'Rate limited (non-client)' });
        }
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'template or text required' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('[send-whatsapp]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
