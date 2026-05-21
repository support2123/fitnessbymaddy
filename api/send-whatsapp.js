const { getClient } = require('../lib/supabase');
const { sendRateLimited, sendTemplate, sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  const expected = `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`;
  if (authHeader !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const supabase = getClient();

    if (text) {
      const ok = await sendText(supabase, phone, text);
      return res.status(200).json({ ok });
    }

    if (template) {
      const result = await sendRateLimited(
        supabase, phone, template, params || {}, !!is_client
      );
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Provide template or text' });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
