const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/utils');

const rateLimitCache = new Map();

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, template_name, is_client } = req.body;

    if (!phone || (!message && !template_name)) {
      return res.status(400).json({ error: 'Missing phone or message/template' });
    }

    if (!is_client) {
      const now = Date.now();
      const lastSent = rateLimitCache.get(phone);
      const TWO_HOURS = 2 * 60 * 60 * 1000;

      if (lastSent && now - lastSent < TWO_HOURS) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', phone)
          .eq('direction', 'out')
          .gte('sent_at', new Date(now - TWO_HOURS).toISOString());

        if (count > 0) {
          console.log(`Rate limited: ${maskPhone(phone)}`);
          return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
        }
      }
    }

    const result = await sendWhatsApp(phone, message, template_name);
    rateLimitCache.set(phone, Date.now());

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
