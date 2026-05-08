const { sendTemplate, sendMessage } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/pii');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate internal authorization
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!process.env.INTERNAL_API_SECRET || token !== process.env.INTERNAL_API_SECRET) {
      console.warn('[send-whatsapp] Unauthorized request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template_name, params, message } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: 'Missing required field: phone' });
    }

    if (!template_name && !message) {
      return res.status(400).json({ error: 'Must provide either template_name or message' });
    }

    let result;

    if (template_name) {
      console.log(`[send-whatsapp] Sending template "${template_name}" to ${maskPhone(phone)}`);
      result = await sendTemplate(phone, template_name, params || []);
    } else {
      console.log(`[send-whatsapp] Sending message to ${maskPhone(phone)}`);
      result = await sendMessage(phone, message);
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('[send-whatsapp] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
