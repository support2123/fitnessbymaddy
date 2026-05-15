const { sendTemplate, sendMedia, canSendMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, media_url, skip_rate_limit } = req.body || {};

    if (!phone || !template) {
      return res.status(400).json({ error: 'phone and template required' });
    }

    if (!skip_rate_limit) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited', retry_after: 7200 });
      }
    }

    let result;
    if (media_url) {
      result = await sendMedia(phone, template, media_url, params || []);
    } else {
      result = await sendTemplate(phone, template, params || [], !!skip_rate_limit);
    }

    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
