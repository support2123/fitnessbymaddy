const { sendTemplate, sendText, maskPhone } = require('./_lib/whatsapp');
const { canSendMessage, logMessage } = require('./_lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, message, forceBypassRateLimit } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone is required' });
    if (!template && !message) return res.status(400).json({ error: 'template or message required' });

    if (!forceBypassRateLimit && !(await canSendMessage(phone))) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2hrs for leads' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
      await logMessage(phone, 'out', null, template);
    } else {
      result = await sendText(phone, message);
      await logMessage(phone, 'out', message, null);
    }

    console.log(`Sent to ${maskPhone(phone)}: ${template || 'text'}`);
    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
