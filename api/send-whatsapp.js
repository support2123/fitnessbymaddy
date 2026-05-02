const { sendTemplate, sendSessionMessage, canSendToLead } = require('./lib/whatsapp');
const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, message, media_url, skip_rate_limit } = req.body;

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  if (!skip_rate_limit) {
    const allowed = await canSendToLead(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited: 1 message per 2 hours for leads' });
    }
  }

  let result;
  if (template) {
    result = await sendTemplate(phone, template, params || [], media_url);
  } else if (message) {
    result = await sendSessionMessage(phone, message);
  } else {
    return res.status(400).json({ error: 'Provide template or message' });
  }

  res.status(200).json({ success: true, result });
};
