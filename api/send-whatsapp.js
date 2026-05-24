const { sendWhatsApp, sendFreeformWhatsApp } = require('../lib/whatsapp');
const { corsHeaders } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, message, mediaUrl } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    let result;
    if (template) {
      result = await sendWhatsApp(phone, template, params || [], mediaUrl);
    } else if (message) {
      result = await sendFreeformWhatsApp(phone, message);
    } else {
      return res.status(400).json({ error: 'template or message required' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
