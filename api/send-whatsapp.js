const { sendTemplate, sendText, canSendToLead } = require('../lib/whatsapp');
const { supabase } = require('../lib/supabase');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const internalKey = req.headers['x-internal-key'];
    if (internalKey !== process.env.SUPABASE_SERVICE_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, template, params, text, bypass_rate_limit } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!bypass_rate_limit) {
      const canSend = await canSendToLead(phone);
      if (!canSend) {
        return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for leads' });
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'template or text required' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('[Send WA Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
