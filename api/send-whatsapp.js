const { sendTemplate, sendText, maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify internal API key
  if (req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, message, template_name, template_params } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: 'Missing required field: phone' });
    }

    if (!message && !template_name) {
      return res.status(400).json({
        error: 'Must provide either message or template_name',
      });
    }

    let result;

    if (template_name) {
      result = await sendTemplate(phone, template_name, template_params || {});
    } else {
      result = await sendText(phone, message);
    }

    if (!result.success) {
      console.error(
        `WhatsApp send failed for ${maskPhone(phone)}: ${result.reason}`
      );
      return res.status(500).json({
        success: false,
        error: result.reason || 'Send failed',
      });
    }

    return res.status(200).json({
      success: true,
      message_id: result.data?.message_id || result.data?.id || null,
    });
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
