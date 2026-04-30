const { sendTemplate, sendText, canSendToLead, maskPhone } = require('./_lib/whatsapp');
const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, params, text, skipRateLimit } = req.body;

  if (!phone) return res.status(400).json({ error: 'Phone required' });

  if (!skipRateLimit) {
    const allowed = await canSendToLead(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
    }
  }

  try {
    if (type === 'template') {
      const result = await sendTemplate(phone, templateName, params || []);
      return res.status(200).json({ ok: true, result });
    }

    if (type === 'text') {
      const ok = await sendText(phone, text);
      return res.status(ok ? 200 : 500).json({ ok });
    }

    return res.status(400).json({ error: 'Type must be "template" or "text"' });
  } catch (err) {
    console.error('send-whatsapp error:', maskPhone(phone), err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
