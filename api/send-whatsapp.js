const { sendTemplate, sendText } = require('../lib/whatsapp');
const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { phone, type, templateName, params, text, isClient } = req.body;

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    let result;
    if (type === 'template') {
      result = await sendTemplate(phone, templateName, params || {}, !!isClient);
    } else {
      result = await sendText(phone, text, !!isClient);
    }

    return res.json(result);
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'send failed' });
  }
};
