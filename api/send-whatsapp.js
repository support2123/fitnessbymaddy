const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/messages');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, templateParams, mediaUrl } = req.body;
  if (!phone || !templateName) {
    return res.status(400).json({ error: 'phone and templateName required' });
  }

  const db = getSupabase();

  // Rate limit: max 1 outbound per lead per 2 hrs (skip for active clients)
  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (!client) {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: recentMsgs } = await db
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'out')
      .gte('sent_at', twoHoursAgo)
      .limit(1);

    if (recentMsgs && recentMsgs.length > 0) {
      return res.status(429).json({
        error: 'Rate limited',
        detail: `Already messaged ${maskPhone(phone)} in last 2 hours`,
      });
    }
  }

  // Check opt-out
  const { data: lead } = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .maybeSingle();

  if (lead && lead.status === 'dropped') {
    return res.status(403).json({ error: 'Lead opted out' });
  }

  try {
    const result = await sendWhatsApp(phone, templateName, templateParams, mediaUrl);
    await logMessage(phone, 'out', `Template: ${templateName}`, templateName);
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
