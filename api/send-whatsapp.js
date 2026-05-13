const { sendTemplate, sendText, canSendMessage } = require('../lib/whatsapp');
const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, params, message, mediaUrl, forceClient } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });

  const allowed = await canSendMessage(phone, !!forceClient);
  if (!allowed) {
    return res.status(429).json({ error: 'Rate limited — max 1 message per 2hrs for leads' });
  }

  let result;
  if (type === 'template') {
    result = await sendTemplate(phone, templateName, params || [], mediaUrl);
  } else {
    result = await sendText(phone, message);
  }

  return res.status(result.ok ? 200 : 502).json(result);
};
