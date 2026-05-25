const { sendTemplate, sendText } = require('../lib/whatsapp');
const { canSendMessage, logMessage } = require('../lib/rate-limit');
const { getClient } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, text, force } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  if (!force) {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 per 2hrs' });
    }
  }

  let result;
  if (template) {
    result = await sendTemplate(phone, template, params || []);
    await logMessage(phone, 'out', `Template: ${template}`, template);
  } else if (text) {
    result = await sendText(phone, text);
    await logMessage(phone, 'out', text, null);
  } else {
    return res.status(400).json({ error: 'template or text required' });
  }

  return res.status(result.ok ? 200 : 502).json(result);
};
