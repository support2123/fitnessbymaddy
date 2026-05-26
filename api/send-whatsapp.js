const { sendTemplate, sendText, maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Internal-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify internal API key
    const internalKey = req.headers['x-internal-key'];
    if (!internalKey || internalKey !== process.env.INTERNAL_API_KEY) {
      console.warn('[send-whatsapp] Unauthorized request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template_name, params, text_message } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    if (!template_name && !text_message) {
      return res.status(400).json({ error: 'Either template_name or text_message is required' });
    }

    let result;

    if (template_name) {
      console.log(`[send-whatsapp] Sending template "${template_name}" to ${maskPhone(phone)}`);
      result = await sendTemplate(phone, template_name, params || {});
    } else {
      console.log(`[send-whatsapp] Sending text to ${maskPhone(phone)}`);
      result = await sendText(phone, text_message);
    }

    if (!result.success) {
      return res.status(result.reason === 'rate_limited' ? 429 : 502).json({
        success: false,
        reason: result.reason || result.error || 'send_failed',
      });
    }

    return res.status(200).json({
      success: true,
      message_id: result.data?.message_id || null,
    });
  } catch (err) {
    console.error('[send-whatsapp] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
