const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendTemplateForced, canSendMessage } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers['authorization'];
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template_name, params, force } = req.body;

    if (!phone || !template_name) {
      return res.status(400).json({ error: 'Missing phone or template_name' });
    }

    if (force) {
      const result = await sendTemplateForced(phone, template_name, params || {});
      return res.status(result.ok ? 200 : 429).json(result);
    }

    const allowed = await canSendMessage(phone, false);
    if (!allowed) {
      return res.status(429).json({ ok: false, reason: 'rate_limited' });
    }

    const result = await sendTemplate(phone, template_name, params || {});
    return res.status(result.ok ? 200 : 500).json(result);

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
