const { sendTemplate, sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, params, text } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  try {
    let result;
    if (templateName) {
      result = await sendTemplate(phone, templateName, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'templateName or text required' });
    }
    res.status(200).json(result);
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
};
