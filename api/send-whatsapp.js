const { sendTemplate, sendText } = require('./_lib/whatsapp');

function maskPhone(phone) {
  if (!phone || phone.length < 4) return '***';
  return '***' + phone.slice(-3);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, template_name, params, text } = req.body || {};

    // Validate request
    if (!phone) {
      return res.status(400).json({ error: 'Missing required field: phone' });
    }

    if (!template_name && !text) {
      return res.status(400).json({
        error: 'Must provide either template_name or text',
      });
    }

    let result;

    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else {
      result = await sendText(phone, text);
    }

    return res.status(200).json({
      success: true,
      result,
    });
  } catch (err) {
    const phone = req.body?.phone;
    console.error(`Send WhatsApp error for ${maskPhone(phone)}:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
