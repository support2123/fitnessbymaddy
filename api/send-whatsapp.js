const { canSendMessage, sendTemplate, sendFreeform } = require('../lib/whatsapp');
const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, message, forceClient } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const canSend = await canSendMessage(phone, !!forceClient);
    if (!canSend) {
      return res.status(429).json({ error: 'Rate limited — 2hr window not elapsed' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (message) {
      result = await sendFreeform(phone, message);
    } else {
      return res.status(400).json({ error: 'Provide template or message' });
    }

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
