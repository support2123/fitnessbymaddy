const { sendWithRateLimit, sendTemplate, sendText } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text, is_client, bypass_rate_limit } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    let result;
    if (text) {
      result = await sendText(phone, text);
    } else if (template) {
      if (bypass_rate_limit) {
        result = await sendTemplate(phone, template, params || []);
      } else {
        result = await sendWithRateLimit(phone, template, params || [], is_client);
      }
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
