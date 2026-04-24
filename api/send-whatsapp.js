const { sendTemplate, sendText, canSendToLead } = require('../lib/whatsapp');
const { corsHeaders, maskPhone } = require('../lib/utils');
const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, type, template, params, text, skipRateLimit } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    if (!skipRateLimit) {
      const canSend = await canSendToLead(phone);
      if (!canSend) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2hrs for leads' });
      }
    }

    let result;
    if (type === 'template' && template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (type === 'text' && text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide type=template with template name, or type=text with text' });
    }

    console.log(`Sent ${type} to ${maskPhone(phone)}`);
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ error: 'Failed to send' });
  }
};
