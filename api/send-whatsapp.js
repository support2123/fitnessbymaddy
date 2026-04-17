const { sendTemplate, sendText, checkRateLimit } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template, params, text, bypass_rate_limit } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    if (!bypass_rate_limit) {
      const canSend = await checkRateLimit(phone);
      if (!canSend) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('[send-whatsapp]', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
