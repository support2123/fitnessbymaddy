const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, template_name, params, bypass_rate_limit } = req.body;

  if (!phone || !template_name) {
    return res.status(400).json({ error: 'Missing phone or template_name' });
  }

  const supabase = getSupabase();

  // Rate limit check (unless client or bypass flag)
  if (!bypass_rate_limit) {
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (!client) {
      const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
      const { data: recentMessages } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', phone)
        .eq('direction', 'out')
        .gt('sent_at', cutoff)
        .limit(1);

      if (recentMessages && recentMessages.length > 0) {
        return res.status(429).json({
          error: 'Rate limited',
          message: `Max 1 outbound per 2hrs for non-clients. Phone: ${maskPhone(phone)}`
        });
      }
    }
  }

  try {
    await sendWhatsApp(phone, template_name, params || {});

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `Template: ${template_name}`,
      template_name,
      sent_at: new Date().toISOString(),
      status: 'sent'
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `FAILED: ${template_name} - ${err.message}`,
      template_name,
      sent_at: new Date().toISOString(),
      status: 'failed'
    });

    return res.status(500).json({ error: 'Send failed', detail: err.message });
  }
};
