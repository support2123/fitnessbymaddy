const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, sendFreeformWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, message } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' });
  }

  const db = getSupabase();

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  const { data: client } = await db
    .from('clients')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  const isActiveClient = !!client;
  if (!isActiveClient && count >= 1) {
    return res.status(429).json({
      error: 'Rate limited — max 1 outbound per 2hrs for non-clients',
    });
  }

  try {
    let result;
    if (template) {
      result = await sendWhatsApp(phone, template, params || []);
    } else if (message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'template or message is required' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('[send-whatsapp] Error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
