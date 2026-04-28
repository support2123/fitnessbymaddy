const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers['x-api-key'];
  if (auth !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params } = req.body;
  if (!phone || !template) {
    return res.status(400).json({ error: 'phone and template are required' });
  }

  const db = getSupabase();
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

  const { data: recentMessages } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  const { data: lead } = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();

  const isClient = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (!isClient.data && recentMessages && recentMessages.length > 0) {
    return res.status(429).json({
      error: 'Rate limited — max 1 outbound per 2hrs for non-clients'
    });
  }

  if (lead && lead.status === 'dropped') {
    return res.status(403).json({ error: 'Lead opted out — cannot message' });
  }

  const result = await sendWhatsApp(phone, template, params || []);
  return res.status(result.ok ? 200 : 500).json(result);
};
