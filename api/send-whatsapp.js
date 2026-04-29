const { supabase } = require('../lib/supabase');
const { sendTemplate, sendSessionMessage, canSendMessage } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, type, template_name, message, params, is_client } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const allowed = await canSendMessage(phone, !!is_client);
    if (!allowed) {
      return res.status(429).json({
        error: 'Rate limited',
        message: `Max 1 outbound message per 2 hours for non-opted-in leads. Phone: ${maskPhone(phone)}`
      });
    }

    let result;

    if (type === 'template' && template_name) {
      result = await sendTemplate(phone, template_name, params || {});
    } else if (type === 'session' && message) {
      result = await sendSessionMessage(phone, message);
    } else {
      return res.status(400).json({ error: 'Specify type=template with template_name, or type=session with message' });
    }

    return res.status(result.success ? 200 : 502).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
