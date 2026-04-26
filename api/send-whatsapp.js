const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { canSendMessage, logMessage } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, params, message, isClient } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) {
    return res.status(429).json({ error: 'Rate limited — last message sent <2hrs ago' });
  }

  let result;
  if (type === 'template') {
    result = await sendTemplate(phone, templateName, params || []);
    await logMessage(phone, 'out', `[template:${templateName}] ${(params || []).join(', ')}`, templateName);
  } else {
    result = await sendText(phone, message);
    await logMessage(phone, 'out', message);
  }

  return res.status(200).json({ ok: true, result });
};
