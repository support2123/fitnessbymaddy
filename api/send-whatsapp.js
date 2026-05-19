const { canSendMessage, sendTemplate, sendText } = require('./_lib/whatsapp');
const { cors, parseBody } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { phone, template, params, text, is_client } = body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const allowed = await canSendMessage(phone, !!is_client);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limited — max 1 message per 2hrs for non-clients' });
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return res.status(400).json({ error: 'Provide template or text' });
    }

    return res.json({ ok: true, result });
  } catch (err) {
    console.error('send-whatsapp error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
