const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Verify internal API key
  const internalKey = req.headers['x-internal-key'];
  if (!internalKey || internalKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { phone, templateName, params, body } = req.body || {};

  if (!phone) {
    return res.status(400).json({ error: 'missing_phone' });
  }

  if (!templateName && !body) {
    return res.status(400).json({ error: 'missing_template_or_body' });
  }

  try {
    const result = await sendWhatsApp({
      phone,
      templateName: templateName || 'generic',
      params: params || [],
      body: body || '',
    });

    const statusCode = result.ok ? 200 : 502;
    return res.status(statusCode).json(result);
  } catch (err) {
    console.error('[send-whatsapp] Error:', err.message);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
};
