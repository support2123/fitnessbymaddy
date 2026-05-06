const { sendTemplate, sendText, canSend } = require('./_lib/whatsapp');
const { corsHeaders } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { phone, type, template_name, params, text, is_client } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'phone required' });
  }

  const allowed = await canSend(phone, !!is_client);
  if (!allowed) {
    return res.status(429).json({ error: 'rate limited — wait 2 hours' });
  }

  let result;
  if (type === 'template' && template_name) {
    result = await sendTemplate(phone, template_name, params || []);
  } else if (type === 'text' && text) {
    result = await sendText(phone, text);
  } else {
    return res.status(400).json({ error: 'specify type=template with template_name, or type=text with text' });
  }

  return res.status(result.ok ? 200 : 502).json(result);
};
