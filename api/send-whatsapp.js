const { sendWhatsApp, sendSessionMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, templateName, params, body, mediaUrl, session } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    let result;
    if (session) {
      result = await sendSessionMessage({ phone, text: body });
    } else {
      result = await sendWhatsApp({ phone, templateName, params, body, mediaUrl });
    }

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
