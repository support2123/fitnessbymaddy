const { sendWhatsApp, sendFreeformWhatsApp } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate internal auth
  const authHeader = req.headers.authorization || '';
  const expectedSecret = process.env.INTERNAL_API_SECRET;

  if (!expectedSecret) {
    console.error('[send-whatsapp] INTERNAL_API_SECRET env var not configured');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, params, message } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    if (!templateName && !message) {
      return res.status(400).json({ error: 'Either templateName or message is required' });
    }

    let result;

    if (templateName) {
      // Send template message; params is passed as the object for sendWhatsApp
      result = await sendWhatsApp(phone, templateName, params || {});
    } else {
      // Send freeform session message
      result = await sendFreeformWhatsApp(phone, message);
    }

    if (!result.success) {
      if (result.rateLimited) {
        return res.status(429).json({ error: 'Rate limited', rateLimited: true });
      }
      console.error(`[send-whatsapp] Failed for ${maskPhone(phone)}:`, result.error);
      return res.status(502).json({ error: 'WhatsApp send failed', details: result.error });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    const safePhone = maskPhone(req.body?.phone || '');
    console.error(`[send-whatsapp] Error [${safePhone}]:`, err.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
