const { canSendMessage, sendTemplate, sendText, logMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, message, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const allowed = await canSendMessage(phone, !!is_client);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for leads' });
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
      await logMessage(phone, 'out', template_name, template_name);
    } else if (message) {
      result = await sendText(phone, message);
      await logMessage(phone, 'out', message, null);
    } else {
      return res.status(400).json({ error: 'template_name or message required' });
    }

    return res.json({ status: 'ok', result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
