const { supabase } = require('./lib/supabase');
const { sendWhatsApp, sendFreeformWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, template_name, params, message } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const { data: recentMsgs } = await supabase
      .from('messages')
      .select('sent_at')
      .eq('phone', phone)
      .eq('direction', 'out')
      .order('sent_at', { ascending: false })
      .limit(1);

    if (recentMsgs && recentMsgs.length > 0) {
      const lastSent = new Date(recentMsgs[0].sent_at);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      if (lastSent > twoHoursAgo) {
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('phone', phone)
          .eq('status', 'active')
          .single();

        if (!client) {
          return res.status(429).json({
            error: 'Rate limited — max 1 message per 2 hours for non-clients',
          });
        }
      }
    }

    let result;
    if (template_name) {
      result = await sendWhatsApp(phone, template_name, params || []);
    } else if (message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'Missing template_name or message' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
