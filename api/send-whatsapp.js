const { sendTemplate, sendText, canSendMessage } = require('../lib/whatsapp');
const { parseBody, corsHeaders } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { phone, template, params, text, is_client } = body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    if (!(await canSendMessage(phone, !!is_client))) {
      return res.status(429).json({ error: 'Rate limited. Max 1 message per 2 hours for leads.' });
    }

    if (template) {
      const result = await sendTemplate(phone, template, params || []);
      return res.status(200).json({ success: true, result });
    }

    if (text) {
      const ok = await sendText(phone, text);
      return res.status(ok ? 200 : 500).json({ success: ok });
    }

    return res.status(400).json({ error: 'template or text required' });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
