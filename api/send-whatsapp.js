const { canSendMessage, sendTemplate, sendTextMessage } = require('./lib/whatsapp');
const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('status')
      .eq('phone', phone)
      .single();
    if (lead?.status === 'dropped') {
      return res.status(200).json({ sent: false, reason: 'Lead opted out' });
    }

    if (!force) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return res.status(429).json({ sent: false, reason: 'Rate limited — max 1 message per 2hrs' });
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendTextMessage(phone, text);
    } else {
      return res.status(400).json({ error: 'Either template or text is required' });
    }

    return res.status(200).json({ sent: true, result });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
