const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, template_name, params, message, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (!force && !client) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', phone)
        .eq('direction', 'out')
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();

      if (recentMsg) {
        const elapsed = Date.now() - new Date(recentMsg.sent_at).getTime();
        if (elapsed < RATE_LIMIT_MS) {
          return res.status(429).json({
            error: 'Rate limited',
            retry_after_ms: RATE_LIMIT_MS - elapsed,
          });
        }
      }
    }

    let result;
    if (template_name) {
      result = await sendWhatsApp(phone, template_name, params || []);
    } else if (message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'template_name or message required' });
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
