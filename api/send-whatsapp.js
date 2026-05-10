const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Internal-only: verify auth header
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { phone, type, template_name, message, params } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    // Rate limit: check last outbound message time
    const { data: lastMsg } = await db.from('messages')
      .select('sent_at')
      .eq('phone', phone)
      .eq('direction', 'out')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    if (lastMsg) {
      const lastSent = new Date(lastMsg.sent_at);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      // Check if lead (not client) — clients are exempt from 2hr limit
      const { data: client } = await db.from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      if (!client && lastSent > twoHoursAgo) {
        return res.status(429).json({
          error: 'Rate limited — max 1 message per 2 hours for leads',
          next_allowed: new Date(lastSent.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        });
      }
    }

    // Check opt-out status
    const { data: lead } = await db.from('leads')
      .select('status')
      .eq('phone', phone)
      .single();

    if (lead?.status === 'dropped') {
      return res.status(403).json({ error: 'Lead has opted out' });
    }

    // Send message
    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (message) {
      result = await sendText(phone, message);
    } else {
      return res.status(400).json({ error: 'Must provide template_name or message' });
    }

    // Log outbound
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: message || `Template: ${template_name}`,
      template_name: template_name || null,
      sent_at: new Date().toISOString(),
      status: 'sent',
    });

    console.log(`Sent to ${maskPhone(phone)}: ${type || 'text'}`);
    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
