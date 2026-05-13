const { sendTemplate, sendFreeform, canSendMessage } = require('../lib/whatsapp');
const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, templateName, params, message, isClient } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone is required' });

  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) {
    return res.status(429).json({ error: 'Rate limited — wait 2 hours between messages to non-clients' });
  }

  if (templateName) {
    const result = await sendTemplate(phone, templateName, params || []);
    return res.status(result.ok ? 200 : 502).json(result);
  }

  if (message) {
    const result = await sendFreeform(phone, message);
    return res.status(result.ok ? 200 : 502).json(result);
  }

  return res.status(400).json({ error: 'templateName or message is required' });
};
