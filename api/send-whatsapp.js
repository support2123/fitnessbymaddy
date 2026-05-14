const { sendTemplate, sendTextMessage, normalizePhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const expectedKey = process.env.INTERNAL_API_KEY;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, text, params } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let result;
    if (template) {
      result = await sendTemplate(normalizePhone(phone), template, params || {});
    } else if (text) {
      result = await sendTextMessage(normalizePhone(phone), text);
    } else {
      return res.status(400).json({ error: 'template or text required' });
    }

    return res.status(result.ok ? 200 : 429).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
