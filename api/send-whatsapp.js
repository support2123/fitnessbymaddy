const { sendTemplate, sendText, canSendMessage } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text, isClient, userName } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const allowed = await canSendMessage(phone, !!isClient);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limit: max 1 msg per 2hrs for leads' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || [], userName);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    return res.status(200).json({ sent: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Send failed' });
  }
};
