const { sendTemplate, sendFreeformMessage, canSendToLead } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, message, forceSkipRateLimit } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    if (!forceSkipRateLimit) {
      const canSend = await canSendToLead(phone);
      if (!canSend) {
        return res.status(429).json({
          error: 'Rate limited — last message was under 2 hours ago',
          phone: maskPhone(phone),
        });
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (message) {
      result = await sendFreeformMessage(phone, message);
    } else {
      return res.status(400).json({ error: 'template or message required' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('[send-whatsapp] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
