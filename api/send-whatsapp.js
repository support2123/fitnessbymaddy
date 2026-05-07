const { sendWhatsApp, sendFreeformMessage, maskPhone } = require('../lib/whatsapp');
const { logMessage, canSendMessage, isOptedOut } = require('../lib/messages');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, message } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    if (await isOptedOut(phone)) {
      return res.status(200).json({ sent: false, reason: 'opted_out' });
    }

    if (!(await canSendMessage(phone))) {
      return res.status(429).json({ sent: false, reason: 'rate_limited' });
    }

    let result;
    if (template) {
      result = await sendWhatsApp(phone, template, params || []);
      await logMessage(phone, 'out', (params || []).join(' '), template);
    } else if (message) {
      result = await sendFreeformMessage(phone, message);
      await logMessage(phone, 'out', message);
    } else {
      return res.status(400).json({ error: 'Provide template or message' });
    }

    return res.status(200).json({ sent: true, result: result.data });
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
