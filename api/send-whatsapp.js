const { sendTemplate, sendFreeform, canSendMessage } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, template_name, params, freeform_body, is_client } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const allowed = await canSendMessage(phone, !!is_client);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 msg per 2 hrs for leads' });
    }

    if (template_name) {
      const result = await sendTemplate(phone, template_name, params || []);
      return res.status(result.ok ? 200 : 502).json(result);
    }

    if (freeform_body) {
      const result = await sendFreeform(phone, freeform_body);
      return res.status(result.ok ? 200 : 502).json(result);
    }

    return res.status(400).json({ error: 'Provide template_name or freeform_body' });
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
