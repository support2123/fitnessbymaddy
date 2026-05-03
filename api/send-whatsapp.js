const { sendTemplate, sendText, sendMedia } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  const expected = `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`;
  if (authHeader !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, params, text, media_url, caption, is_client } = req.body || {};

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    const isClient = is_client === true;

    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || [], isClient);
    } else if (type === 'media' && media_url) {
      result = await sendMedia(phone, media_url, caption || '', isClient);
    } else if (text) {
      result = await sendText(phone, text, isClient);
    } else {
      return res.status(400).json({ error: 'Provide template_name, text, or media_url' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error(`Send WhatsApp error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};
