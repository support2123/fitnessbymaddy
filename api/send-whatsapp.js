const { sendTemplate, sendSessionMessage, sendMediaMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers['authorization'] || '';
    const expectedKey = process.env.INTERNAL_API_KEY;
    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, type, template_name, params, text, media_url, caption } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let result;

    if (type === 'template') {
      if (!template_name) return res.status(400).json({ error: 'Missing template_name' });
      result = await sendTemplate(phone, template_name, params || []);
    } else if (type === 'media') {
      if (!media_url) return res.status(400).json({ error: 'Missing media_url' });
      result = await sendMediaMessage(phone, media_url, caption);
    } else {
      if (!text) return res.status(400).json({ error: 'Missing text' });
      result = await sendSessionMessage(phone, text);
    }

    return res.status(200).json({ success: true, ...result });

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
