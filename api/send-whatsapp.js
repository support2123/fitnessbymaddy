const { canSendToLead, sendTemplate, sendText, logMessage } = require('../lib/whatsapp');
const { getClient } = require('../lib/supabase');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, templateName, params, text, isClient, force } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  try {
    if (!isClient && !force) {
      const allowed = await canSendToLead(phone);
      if (!allowed) {
        return res.status(429).json({
          error: 'Rate limited — last message sent within 2 hours',
          phone: maskPhone(phone),
        });
      }
    }

    let result;
    if (templateName) {
      result = await sendTemplate(phone, templateName, params || []);
      await logMessage(phone, 'out', `[template: ${templateName}]`, templateName);
    } else if (text) {
      result = await sendText(phone, text);
      await logMessage(phone, 'out', text);
    } else {
      return res.status(400).json({ error: 'templateName or text required' });
    }

    return res.status(200).json({ sent: true, result });
  } catch (err) {
    console.error('send-whatsapp error:', maskPhone(phone), err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};
