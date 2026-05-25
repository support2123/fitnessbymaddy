const { sendWhatsApp } = require('../lib/whatsapp');

/**
 * Masks a phone number for safe logging.
 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, -4).replace(/.(?=.{4})/g, '*').slice(0, -4) + phone.slice(-4);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    /* -- API key check: require internal API_SECRET header -- */
    const apiSecret = process.env.API_SECRET;
    if (!apiSecret || req.headers['x-api-secret'] !== apiSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template_name, params } = req.body || {};

    if (!phone || !template_name) {
      return res
        .status(400)
        .json({ error: 'Missing required fields: phone, template_name' });
    }

    /* -- Send via lib/whatsapp.js -- */
    const result = await sendWhatsApp(phone, template_name, params || {});

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to send message',
      });
    }

    return res.status(200).json({
      success: true,
      messageId: result.messageId || null,
    });
  } catch (err) {
    const safePhone = maskPhone((req.body || {}).phone || '');
    console.error(`send-whatsapp error [${safePhone}]:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
