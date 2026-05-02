const { sendTemplate, sendText, canSendToLead, maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, type, templateName, params, text, isClient } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });

  if (!isClient) {
    const allowed = await canSendToLead(phone);
    if (!allowed) {
      return res.status(429).json({
        error: 'Rate limited',
        detail: `Lead ${maskPhone(phone)} messaged within last 2hrs`
      });
    }
  }

  try {
    let result;
    if (type === 'template') {
      result = await sendTemplate(phone, templateName, params);
    } else {
      result = await sendText(phone, text);
    }
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return res.status(500).json({ error: 'Send failed', detail: err.message });
  }
};
