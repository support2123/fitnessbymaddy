const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  try {
    const { phone, type, template_name, params, text } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    let result;

    if (type === 'template') {
      if (!template_name) {
        return res.status(400).json({ error: 'template_name required for template type' });
      }
      result = await sendTemplate(phone, template_name, params || [], { supabase });
    } else if (type === 'text') {
      if (!text) {
        return res.status(400).json({ error: 'text required for text type' });
      }
      result = await sendText(phone, text, { supabase });
    } else {
      return res.status(400).json({ error: 'type must be "template" or "text"' });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
