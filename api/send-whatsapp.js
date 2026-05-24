const { sendTemplate, canSend, logMessage, maskPhone } = require('../lib/whatsapp');

const ALLOWED_ORIGIN = 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify internal API key
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, templateName, params, isClient } = req.body || {};

    if (!phone || !templateName) {
      return res.status(400).json({ error: 'Missing required fields: phone, templateName' });
    }

    // Rate limit check for non-clients
    if (!isClient) {
      const allowed = await canSend(phone);
      if (!allowed) {
        console.log(`Rate limited send attempt for ${maskPhone(phone)}`);
        return res.status(429).json({ error: 'Rate limited', retry_after: '2h' });
      }
    }

    // Send the template
    const result = await sendTemplate(phone, templateName, params || []);

    if (!result.success) {
      console.error(`Send failed for ${maskPhone(phone)}: ${result.reason}`);

      if (result.reason === 'rate_limited') {
        return res.status(429).json({ error: 'Rate limited', retry_after: '2h' });
      }

      return res.status(502).json({ error: 'Failed to send message' });
    }

    console.log(`Template "${templateName}" sent to ${maskPhone(phone)} via send-whatsapp`);

    return res.status(200).json({
      status: 'sent',
      template: templateName
    });
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
