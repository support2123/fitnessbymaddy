const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText, checkRateLimit } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, template, params, text, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });
    if (!template && !text) return res.status(400).json({ error: 'Missing template or text' });

    const normalizedPhone = phone.replace(/[^0-9]/g, '');
    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('status')
      .eq('phone', normalizedPhone)
      .single();

    if (lead && lead.status === 'dropped') {
      return res.status(403).json({ error: 'Lead has opted out' });
    }

    if (!force) {
      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', normalizedPhone)
        .eq('status', 'active')
        .single();

      if (!client) {
        const rateLimited = await checkRateLimit(normalizedPhone);
        if (rateLimited) {
          return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for leads' });
        }
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(normalizedPhone, template, params || []);
    } else {
      result = await sendText(normalizedPhone, text);
    }

    return res.json({ ok: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
