const { sendTemplate, sendMessage } = require('./lib/whatsapp');
const { canSendMessage, logMessage } = require('./lib/ratelimit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, message, template_name, params, force } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });
  if (!message && !template_name) return res.status(400).json({ error: 'message or template_name required' });

  if (!force) {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited: max 1 message per 2 hours for this number' });
    }
  }

  let result;
  if (template_name) {
    result = await sendTemplate(phone, template_name, params || []);
    await logMessage(phone, 'out', `[template: ${template_name}]`, template_name);
  } else {
    result = await sendMessage(phone, message);
    await logMessage(phone, 'out', message);
  }

  return res.status(200).json({ success: true, result });
};
