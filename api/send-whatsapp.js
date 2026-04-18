const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const rateLimitMap = new Map();

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, template_name, params, media_url, force } = req.body;

    if (!phone || !template_name) {
      return res.status(400).json({ error: 'Missing phone or template_name' });
    }

    if (!force) {
      const db = getSupabase();
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      const { data: recentMessages } = await db
        .from('messages')
        .select('id')
        .eq('phone', phone)
        .eq('direction', 'out')
        .gte('sent_at', twoHoursAgo)
        .limit(1);

      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      if (recentMessages?.length > 0 && !client) {
        return res.status(429).json({
          error: 'Rate limited',
          message: 'Max 1 outbound message per lead per 2 hours',
        });
      }
    }

    const { data: droppedLead } = await getSupabase()
      .from('leads')
      .select('status')
      .eq('phone', phone)
      .eq('status', 'dropped')
      .single();

    if (droppedLead) {
      return res.status(403).json({
        error: 'Opted out',
        message: 'Lead has opted out — cannot send messages',
      });
    }

    const result = await sendWhatsApp(
      phone,
      template_name,
      params || [],
      media_url || null
    );

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
