const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendTextMessage, normalizePhone, maskPhone } = require('./lib/whatsapp');
const { canSendToLead, logMessage } = require('./lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, template_name, params, text, bypass_rate_limit } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (!template_name && !text) {
      return res.status(400).json({ error: 'template_name or text required' });
    }

    const normalized = normalizePhone(phone);

    if (!bypass_rate_limit) {
      const allowed = await canSendToLead(normalized);
      if (!allowed) {
        return res.status(429).json({
          error: 'Rate limited',
          message: `Max 1 message per 2 hours for ${maskPhone(normalized)}`,
        });
      }
    }

    let result;
    if (template_name) {
      result = await sendTemplate(normalized, template_name, params || []);
      await logMessage(normalized, 'out', `Template: ${template_name}`, template_name);
    } else {
      result = await sendTextMessage(normalized, text);
      await logMessage(normalized, 'out', text, null);
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
