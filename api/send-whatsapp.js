const { sendTemplate, sendText } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

  return res.status(result.ok ? 200 : 429).json(result);
};
