const { sendTemplate, sendText, canSendToLead } = require('../lib/whatsapp');
const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers['x-internal-key'];
  if (auth !== process.env.INTERNAL_API_KEY && auth !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, text, params, skipRateLimit } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  if (!skipRateLimit) {
    const allowed = await canSendToLead(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hrs for leads' });
    }
  }

  if (template) {
    const result = await sendTemplate(phone, template, params || {});
    return res.status(result.ok ? 200 : 502).json(result);
  }

  if (text) {
    const result = await sendText(phone, text);
    return res.status(result.ok ? 200 : 502).json(result);
  }

  return res.status(400).json({ error: 'template or text required' });
};
