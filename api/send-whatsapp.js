const { getClient } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, template, params, text, force } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    if (!template && !text) {
      return res.status(400).json({ error: 'Missing template or text' });
    }

    if (!force) {
      const db = getClient();

      const { data: isClient } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .limit(1)
        .single();

      if (!isClient) {
        const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
        const { data: recent } = await db
          .from('messages')
          .select('id')
          .eq('direction', 'out')
          .gte('sent_at', cutoff)
          .limit(1)
          .single();

        if (recent) {
          return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
        }
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else {
      result = await sendText(phone, text);
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
