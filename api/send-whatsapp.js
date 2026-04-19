const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const internalKey = req.headers['x-internal-key'];
    if (internalKey !== process.env.SUPABASE_SERVICE_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, templateName, params, body } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    const result = await sendWhatsApp({ phone, templateName, params, body });

    if (result.skipped) {
      console.log(`[SEND-WA] Skipped ${maskPhone(phone)}: ${result.reason}`);
      return res.status(200).json({ skipped: true, reason: result.reason });
    }

    console.log(`[SEND-WA] Sent to ${maskPhone(phone)}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[SEND-WA ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
