const { sendTemplate, sendText, maskPhone } = require('../lib/whatsapp');
const { canSendMessage, logMessage } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, templateName, message, params, skipRateLimit } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    if (!skipRateLimit) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
      }
    }

    let result;
    if (type === 'template' && templateName) {
      result = await sendTemplate(phone, templateName, params);
      await logMessage(phone, 'out', `Template: ${templateName}`, templateName);
    } else if (type === 'text' && message) {
      result = await sendText(phone, message);
      await logMessage(phone, 'out', message, null);
    } else {
      return res.status(400).json({ error: 'Provide type=template+templateName or type=text+message' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('[SendWA Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
