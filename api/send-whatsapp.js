const { sendTemplate, sendText, sendMedia } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, text, media_url, caption, params, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;

    if (type === 'template') {
      if (!template_name) return res.status(400).json({ error: 'Missing template_name' });
      result = await sendTemplate(phone, template_name, params || {});
    } else if (type === 'media') {
      if (!media_url) return res.status(400).json({ error: 'Missing media_url' });
      result = await sendMedia(phone, media_url, caption || '', !!is_client);
    } else {
      if (!text) return res.status(400).json({ error: 'Missing text' });
      result = await sendText(phone, text, !!is_client);
    }

    if (!result.ok && result.reason === 'rate_limited') {
      return res.status(429).json({ error: 'Rate limited', reason: result.reason });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
