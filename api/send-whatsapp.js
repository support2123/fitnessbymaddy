const { sendTemplate, sendText } = require('../lib/whatsapp');
const { corsHeaders } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders());
    return res.end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, params, text, mediaUrl } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'phone required' });
  }

  let result;
  if (type === 'template') {
    result = await sendTemplate(phone, templateName, params || [], mediaUrl);
  } else {
    result = await sendText(phone, text);
  }

  return res.status(result.ok ? 200 : 429).json(result);
};
