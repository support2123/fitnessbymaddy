const { getSupabase } = require('../lib/supabase');
const { canSendMessage, sendTemplate, sendTextMessage, logMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Internal-only: verify with a simple shared secret
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text, force } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    // Rate limit check (skip for forced sends to opted-in clients)
    if (!force) {
      const allowed = await canSendMessage(phone, false);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
      await logMessage(phone, 'out', null, template);
    } else if (text) {
      result = await sendTextMessage(phone, text);
      await logMessage(phone, 'out', text, null);
    } else {
      return res.status(400).json({ error: 'template or text required' });
    }

    return res.status(200).json({ success: true, result });

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
