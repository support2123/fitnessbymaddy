const { sendTemplate, sendFreeformMessage, canSendToLead } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, message, skip_rate_limit } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!skip_rate_limit) {
      const allowed = await canSendToLead(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 message per 2hrs for leads' });
      }
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || [], !!skip_rate_limit);
    } else if (message) {
      result = await sendFreeformMessage(phone, message);
    } else {
      return res.status(400).json({ error: 'template_name or message required' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
