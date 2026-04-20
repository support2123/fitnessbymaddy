const supabase = require('../lib/supabase');
const { sendTemplate, sendText, sendMediaMessage } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, message, media_url, caption, bypass_rate_limit } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    if (!bypass_rate_limit) {
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      if (!client) {
        const { data: recentMsg } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', phone)
          .eq('direction', 'out')
          .gte('sent_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (recentMsg && recentMsg.length > 0) {
          return res.status(429).json({ error: 'Rate limited', next_allowed_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() });
        }
      }
    }

    let result;
    if (type === 'template') {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'media') {
      result = await sendMediaMessage(phone, media_url, caption || '');
    } else {
      result = await sendText(phone, message);
    }

    console.log(`Sent ${type || 'text'} to ${maskPhone(phone)}`);
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
