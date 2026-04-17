const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, body, params } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Missing phone number' });
  }

  try {
    const result = await sendWhatsApp({ phone, templateName, body, params });
    console.log(`Send: ${maskPhone(phone)} template=${templateName || 'direct'} sent=${result.sent}`);
    return res.status(200).json(result);
  } catch (err) {
    console.error(`Send failed: ${maskPhone(phone)}`, err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
