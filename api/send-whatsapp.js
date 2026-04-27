const { sendTemplate, sendFreeform, canSendToLead } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, message, params, isClient } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });

  // Rate limit check for non-clients
  if (!isClient) {
    const allowed = await canSendToLead(phone);
    if (!allowed) {
      console.log(`[SEND-WA] Rate limited: ${maskPhone(phone)}`);
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for leads' });
    }
  }

  let result;
  if (template) {
    result = await sendTemplate(phone, template, params || {});
  } else if (message) {
    result = await sendFreeform(phone, message);
  } else {
    return res.status(400).json({ error: 'template or message required' });
  }

  return res.status(result.ok ? 200 : 502).json(result);
};
