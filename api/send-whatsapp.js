const { sendTemplate, sendText, sendMediaMessage, canSendToLead } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const authHeader = req.headers['authorization'] || '';
    const expectedKey = process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!authHeader.includes(expectedKey)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, type, template_name, params, text, media_url, skip_rate_limit } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!skip_rate_limit) {
      const allowed = await canSendToLead(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
      }
    }

    let result;
    if (type === 'template') {
      result = await sendTemplate(phone, template_name, params);
    } else if (type === 'media') {
      result = await sendMediaMessage(phone, text, media_url);
    } else {
      result = await sendText(phone, text);
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
