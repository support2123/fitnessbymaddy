const { sendTemplate, sendText, maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ── Auth check ───────────────────────────────────────────────
    const authHeader = req.headers.authorization || '';
    const expectedKey = process.env.INTERNAL_API_KEY;

    if (!expectedKey) {
      console.error('INTERNAL_API_KEY is not configured');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    if (token !== expectedKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // ── Parse request body ───────────────────────────────────────
    const { phone, templateName, params, text } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: 'Missing required field: phone' });
    }

    if (!templateName && !text) {
      return res
        .status(400)
        .json({ error: 'Provide either templateName or text' });
    }

    const masked = maskPhone(phone);

    // ── Send template or text ────────────────────────────────────
    let result;

    if (templateName) {
      result = await sendTemplate(phone, templateName, params || {});
    } else {
      result = await sendText(phone, text);
    }

    if (!result.success) {
      console.warn(
        `Send failed for ${masked}: ${result.reason}`
      );
      return res.status(result.reason === 'rate_limited' ? 429 : 502).json({
        success: false,
        reason: result.reason,
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
