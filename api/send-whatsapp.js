const { canSendToLead, sendTemplate, sendText, logMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template_name, text, params, skip_rate_limit } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    if (!skip_rate_limit) {
      const canSend = await canSendToLead(phone);
      if (!canSend) {
        return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for leads' });
      }
    }

    let result;
    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || {});
    } else if (type === 'text' && text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Specify type=template with template_name, or type=text with text' });
    }

    return res.status(result.ok ? 200 : 502).json(result);

  } catch (err) {
    console.error(`[send-whatsapp] Error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};
