const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template_name, params } = req.body;
    if (!phone || !template_name) {
      return res.status(400).json({ error: 'phone and template_name required' });
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: recentMsg } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'out')
      .gte('sent_at', twoHoursAgo)
      .limit(1)
      .single();

    const { data: lead } = await supabase
      .from('leads')
      .select('status')
      .eq('phone', phone)
      .single();

    const isClient = !lead || lead.status === 'converted';

    if (recentMsg && !isClient) {
      return res.status(429).json({ error: 'Rate limited: max 1 message per 2hrs for leads' });
    }

    const result = await sendWhatsApp(phone, template_name, params || {});
    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
