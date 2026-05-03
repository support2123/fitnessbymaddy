const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, sendTextMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, bodyValues, text, mediaUrl } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: recentMsgs } = await db
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

    if (!client && recentMsgs && recentMsgs.length > 0) {
      return res.status(429).json({ error: 'Rate limited: max 1 message per 2 hours for non-clients' });
    }

    let result;
    if (templateName) {
      result = await sendWhatsApp({ phone, templateName, bodyValues, mediaUrl });
    } else if (text) {
      result = await sendTextMessage(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide templateName or text' });
    }

    return res.json({ success: result.ok });
  } catch (err) {
    console.error('Send WhatsApp error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
