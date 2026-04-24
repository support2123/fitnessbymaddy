const { sendTemplate, sendText } = require('./_utils/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.includes(process.env.SUPABASE_SERVICE_KEY || '')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template, params, text } = req.body || {};

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Missing template or text' });
    }

    if (result && result.rateLimited) {
      return res.status(429).json({ error: 'Rate limited', result });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
