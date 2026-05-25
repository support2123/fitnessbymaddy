const { sendWhatsApp, canSendMessage } = require('./_lib/whatsapp');
const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, body, params, forceClient } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const canSend = await canSendMessage(phone, !!forceClient);
    if (!canSend) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for leads' });
    }

    const result = await sendWhatsApp({ phone, templateName, body, params });
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
