const { supabase } = require('../lib/supabase');
const { sendTemplate, sendSessionMessage, isRateLimited, isClientPhone } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, template_name, params, message, force } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const { data: droppedLead } = await supabase
      .from('leads')
      .select('status')
      .eq('phone', phone)
      .eq('status', 'dropped')
      .limit(1)
      .single();

    if (droppedLead) {
      return res.status(403).json({ error: 'Recipient has opted out' });
    }

    if (!force) {
      const isClient = await isClientPhone(phone);
      if (!isClient) {
        const rateLimited = await isRateLimited(phone);
        if (rateLimited) {
          return res.status(429).json({ error: 'Rate limited — max 1 message per 2 hours for non-clients' });
        }
      }
    }

    let result;
    if (template_name) {
      result = await sendTemplate(phone, template_name, params || []);
    } else if (message) {
      result = await sendSessionMessage(phone, message);
    } else {
      return res.status(400).json({ error: 'Provide template_name or message' });
    }

    console.log(`WhatsApp sent: ${maskPhone(phone)}, template: ${template_name || 'session'}`);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
