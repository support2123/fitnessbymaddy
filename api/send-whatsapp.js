const { sendTemplate, sendText, sendMedia } = require('../lib/whatsapp');
const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, media_url, caption, user_name } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || [], user_name);
    } else if (type === 'media' && media_url) {
      result = await sendMedia(phone, media_url, caption);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template_name, text, or media_url' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
