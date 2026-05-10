const { sendTemplate, sendText } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'template or text required' });
    }

    return res.json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
