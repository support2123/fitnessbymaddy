const { sendRateLimited, sendTemplate, sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, text, is_client, bypass_rate_limit } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    let result;

    if (text) {
      result = await sendText(phone, text);
    } else if (template_name) {
      if (bypass_rate_limit || is_client) {
        result = await sendTemplate(phone, template_name, params || []);
      } else {
        result = await sendRateLimited(phone, template_name, params || []);
      }
    } else {
      return res.status(400).json({ error: 'template_name or text required' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
