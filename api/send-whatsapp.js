const { sendTemplate, sendMessage } = require('./lib/whatsapp');
const { canSendTo, isOptedIn, logMessage } = require('./lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, template, params, message } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  const optedIn = await isOptedIn(phone);
  if (!optedIn && !(await canSendTo(phone))) {
    return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for non-clients' });
  }

  try {
    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
      await logMessage(phone, 'out', `[template: ${template}]`, template);
    } else if (message) {
      result = await sendMessage(phone, message);
      await logMessage(phone, 'out', message, null);
    } else {
      return res.status(400).json({ error: 'template or message required' });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
