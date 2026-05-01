const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { maskPhone, corsHeaders } = require('./lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, bodyValues, mediaUrl } = req.body || {};
    if (!phone || !templateName) {
      return res.status(400).json({ error: 'phone and templateName required' });
    }

    const db = getSupabase();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await db
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'out')
      .gte('sent_at', twoHoursAgo)
      .limit(1);

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

    const isOptedInClient = isClient.data !== null;

    if (recent && recent.length > 0 && !isOptedInClient) {
      console.log(`[SendWA] Rate limited for ${maskPhone(phone)}`);
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for leads' });
    }

    if (lead && lead.status === 'dropped') {
      return res.status(403).json({ error: 'Lead opted out — will not message' });
    }

    const result = await sendWhatsApp({ phone, templateName, bodyValues, mediaUrl });
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('[SendWA] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
