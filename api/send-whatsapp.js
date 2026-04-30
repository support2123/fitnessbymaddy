const { sendTemplate, sendText, maskPhone } = require('../lib/whatsapp');
const { canSendTo, logMessage } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template_name, params, body, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const allowed = await canSendTo(phone, is_client);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for leads' });
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (body) {
      result = await sendText(phone, body);
    } else {
      return res.status(400).json({ error: 'template_name or body required' });
    }

    await logMessage({
      phone,
      direction: 'out',
      body: body || null,
      templateName: template_name || null,
      status: result.ok ? 'sent' : 'failed',
    });

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
