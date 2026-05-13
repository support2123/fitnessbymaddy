const { sendWhatsApp, sendTemplate } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/mask-phone');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Validate auth
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : '';

    if (!token || token !== process.env.AISENSY_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 2. Parse body
    const { phone, message, template_name, params } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    if (!message && !template_name) {
      return res.status(400).json({ error: 'Must provide message or template_name' });
    }

    console.log(`Send request: ${maskPhone(phone)}, template=${template_name || 'none'}`);

    // 3. Send via appropriate method
    let result;

    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else {
      result = await sendWhatsApp(phone, message, null);
    }

    console.log(`Send result for ${maskPhone(phone)}: ok=${result.ok}`);
    return res.status(200).json({ ok: result.ok, data: result.data || null });

  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
