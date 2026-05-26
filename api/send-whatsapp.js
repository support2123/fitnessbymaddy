const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, sendWhatsAppWithMedia } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const { phone, body, template_name, media_url } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: recentMessages } = await db
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'out')
      .gte('sent_at', twoHoursAgo);

    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (!client && recentMessages && recentMessages.length > 0) {
      return res.status(429).json({
        error: 'Rate limited: max 1 message per 2 hours for non-clients',
      });
    }

    let result;
    if (media_url) {
      result = await sendWhatsAppWithMedia(phone, body, media_url, template_name);
    } else {
      result = await sendWhatsApp(phone, body, template_name);
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
